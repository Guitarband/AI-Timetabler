"""Import Monash 2026 unit metadata and generated sample timetable allocations.

Run without flags to validate the checked-in fixture, --apply to import it, or
--check to verify that the production catalogue matches it. Existing class IDs,
bookings, saved plans and user selections are preserved. The known fictional
seed entries are hidden from the public catalogue, not deleted. Class types,
times, venues and capacities are generated demo data, not official schedules.
"""

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from enrolment.postgres import Database  # noqa: E402

FIXTURE = ROOT / "data/monash_2026_catalogue.json"
RETIRED_CODES = [
    "BIOL 1020",
    "DEMO-ART101",
    "DEMO-ART102",
    "DEMO-ART103",
    "DEMO-BUS101",
    "DEMO-BUS102",
    "DEMO-BUS103",
    "DEMO-ENG101",
    "DEMO-ENG102",
    "DEMO-ENG103",
    "DEMO-HSC101",
    "DEMO-HSC102",
    "DEMO-HSC103",
    "DEMO-IT101",
    "DEMO-IT102",
    "DEMO-IT103",
    "DEMO-SCI101",
    "DEMO-SCI102",
    "DEMO-SCI103",
    "PHIL 1100",
    "PSYC 1010",
    "STAT 2010",
    "WRIT 1000",
]


def load_fixture():
    catalogue = json.loads(FIXTURE.read_text(encoding="utf-8"))
    units = catalogue["units"]
    codes = [unit["code"] for unit in units]
    if catalogue["term_id"] != "2026-fall" or len(units) != 120 or len(set(codes)) != 120:
        raise ValueError("The fixture must contain 120 unique units for 2026-fall.")
    counts = Counter(unit["faculty"] for unit in units)
    if len(counts) != 10 or any(count != 12 for count in counts.values()):
        raise ValueError("The fixture must contain 12 units for each of ten faculties.")
    if any(not unit["title"] or not unit["description"] for unit in units):
        raise ValueError("Every unit needs an official title and Handbook synopsis.")
    if any(len(unit["description"]) > 10000 for unit in units):
        raise ValueError("A Handbook synopsis exceeds the course description limit.")
    if not catalogue.get("schedule_notice", "").startswith("All class times"):
        raise ValueError("The fixture must identify its generated sample schedules.")
    if any(len(unit["classes"]) != 2 for unit in units):
        raise ValueError("Every unit must have two generated sample class groups.")

    class_ids, option_ids = [], []
    groups = []
    options = []
    for unit in units:
        for group in unit["classes"]:
            class_ids.append(group["id"])
            groups.append((group["id"], unit["code"], catalogue["term_id"], group["kind"]))
            labels = [option["label"] for option in group["options"]]
            if not labels or len(labels) != len(set(labels)):
                raise ValueError(f"Class labels must be present and unique: {group['id']}.")
            for option in group["options"]:
                if not (1 <= option["day"] <= 5):
                    raise ValueError(f"Class must be on a weekday: {option['id']}.")
                if not (0 <= option["startMinute"] < option["endMinute"] <= 1440):
                    raise ValueError(f"Invalid class time: {option['id']}.")
                if option["capacity"] <= 0:
                    raise ValueError(f"Invalid class capacity: {option['id']}.")
                option_ids.append(option["id"])
                options.append(
                    (
                        option["id"],
                        group["id"],
                        option["label"],
                        option["day"],
                        option["startMinute"],
                        option["endMinute"],
                        option["room"],
                        option["capacity"],
                        True,
                    )
                )
    if len(class_ids) != len(set(class_ids)) or len(option_ids) != len(set(option_ids)):
        raise ValueError("Class and option IDs must be globally unique.")
    return catalogue, groups, options


def rows_for_units(catalogue):
    return [
        (
            unit["code"],
            unit["title"],
            unit["credits"],
            unit["faculty"],
            unit["description"],
        )
        for unit in catalogue["units"]
    ]


def verify(db, catalogue, groups, options):
    codes = [unit["code"] for unit in catalogue["units"]]
    courses = db.execute(
        'SELECT code,title,credits,faculty,description,"isCatalogueActive" FROM course WHERE code=ANY(%s)',
        (codes,),
    ).fetchall()
    actual_courses = {row["code"]: row for row in courses}
    for code, title, credits, faculty, description in rows_for_units(catalogue):
        row = actual_courses.get(code)
        if not row or tuple(row[key] for key in ("title", "credits", "faculty", "description")) != (
            title,
            credits,
            faculty,
            description,
        ) or not row["isCatalogueActive"]:
            raise ValueError(f"Course metadata differs from the fixture: {code}.")

    class_rows = db.execute(
        'SELECT id,"courseCode","termId",kind FROM course_class WHERE id=ANY(%s)',
        ([row[0] for row in groups],),
    ).fetchall()
    if {
        (row["id"], row["courseCode"], row["termId"], row["kind"])
        for row in class_rows
    } != set(groups):
        raise ValueError("One or more Monash class groups differ from the fixture.")

    option_rows = db.execute(
        'SELECT id,"classId",label,day,"startMinute","endMinute",room,capacity,enabled FROM class_option WHERE id=ANY(%s)',
        ([row[0] for row in options],),
    ).fetchall()
    if {
        (
            row["id"],
            row["classId"],
            row["label"],
            row["day"],
            row["startMinute"],
            row["endMinute"],
            row["room"],
            row["capacity"],
            row["enabled"],
        )
        for row in option_rows
    } != set(options):
        raise ValueError("One or more Monash class options differ from the fixture.")

    counts = db.execute(
        'SELECT faculty,count(*)::int AS total FROM course WHERE "isCatalogueActive"=TRUE GROUP BY faculty ORDER BY faculty'
    ).fetchall()
    if len(counts) != 10 or any(row["total"] != 12 for row in counts):
        raise ValueError("The active database catalogue does not contain 12 units per faculty.")
    term = db.execute(
        "SELECT name FROM academic_term WHERE id=%s", (catalogue["term_id"],)
    ).fetchone()
    if not term or term["name"] != catalogue["term_name"]:
        raise ValueError("The active term name differs from the fixture.")
    return len(courses), len(class_rows), len(option_rows), counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--apply", action="store_true", help="Import into PostgreSQL")
    action.add_argument("--check", action="store_true", help="Verify PostgreSQL contents")
    args = parser.parse_args()
    catalogue, groups, options = load_fixture()
    counts = Counter(unit["faculty"] for unit in catalogue["units"])
    if not args.apply and not args.check:
        print(
            f"Validated {len(catalogue['units'])} Handbook units across {len(counts)} faculties, "
            f"{len(groups)} generated sample class groups and {len(options)} sample timetable allocations. No database changes."
        )
        for faculty, count in sorted(counts.items()):
            print(f"  {faculty}: {count} units")
        return

    load_dotenv(ROOT / ".env")
    database = Database(os.environ["POSTGRES_URL"], catalogue["term_id"])
    with database.connection() as db:
        column = db.execute(
            "SELECT 1 FROM information_schema.columns WHERE table_name='course' AND column_name='isCatalogueActive'"
        ).fetchone()
        if not column:
            raise ValueError("Deploy the course catalogue visibility migration before importing.")
        if args.apply:
            db.execute(
                "INSERT INTO academic_term (id,name) VALUES (%s,%s) ON CONFLICT (id) DO UPDATE SET name=excluded.name",
                (catalogue["term_id"], catalogue["term_name"]),
            )
            with db.cursor() as cursor:
                cursor.executemany(
                    'INSERT INTO course (code,title,credits,faculty,description,"isCatalogueActive") VALUES (%s,%s,%s,%s,%s,TRUE) ON CONFLICT (code) DO UPDATE SET title=excluded.title,credits=excluded.credits,faculty=excluded.faculty,description=excluded.description,"isCatalogueActive"=TRUE',
                    rows_for_units(catalogue),
                )
                cursor.executemany(
                    'INSERT INTO course_class (id,"courseCode","termId",kind) VALUES (%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING',
                    groups,
                )
                cursor.executemany(
                    'INSERT INTO class_option (id,"classId",label,day,"startMinute","endMinute",room,capacity,enabled) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING',
                    options,
                )
            db.execute(
                'UPDATE course SET "isCatalogueActive"=FALSE WHERE code=ANY(%s)',
                (RETIRED_CODES,),
            )
        course_count, group_count, option_count, active_counts = verify(
            db, catalogue, groups, options
        )
    print(
        f"Verified {course_count} active units, {group_count} generated sample class groups, "
        f"and {option_count} sample timetable allocations."
    )
    for row in active_counts:
        print(f"  {row['faculty']}: {row['total']} units")
    print("Production catalogue imported." if args.apply else "Production catalogue check complete.")


if __name__ == "__main__":
    main()
