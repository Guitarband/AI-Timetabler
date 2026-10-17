"""Local administrator CLI. Uses database credentials; never expose this as a public API."""

import argparse
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from enrolment.catalogue import Catalogue  # noqa: E402
from enrolment.postgres import Database  # noqa: E402


def main():
    import os

    load_dotenv(ROOT / ".env")
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    actions.add_parser("availability", help="List capacity, occupancy and remaining seats")
    seed = actions.add_parser("seed", help="Apply the bundled fictional Maya/Leo SQL")
    seed.set_defaults(file=ROOT / "sql/seed_maya_leo.sql")
    assign = actions.add_parser("assign", help="Assign approved courses to one account")
    identity = assign.add_mutually_exclusive_group(required=True)
    identity.add_argument("--student-id")
    identity.add_argument("--user-id")
    assign.add_argument("courses", nargs="+")
    catalogue = actions.add_parser(
        "import", help="Add/update courses, classes and time options from catalogue JSON"
    )
    catalogue.add_argument("file", type=Path)
    capacity = actions.add_parser(
        "capacity", help="Set option capacity; cannot reduce below occupied seats"
    )
    capacity.add_argument("option")
    capacity.add_argument("seats", type=int)
    args = parser.parse_args()
    database = Database(os.environ["POSTGRES_URL"], os.getenv("TERM_ID", "2026-fall"))
    with database.connection() as db:
        if args.action == "seed":
            db.execute(args.file.read_text(encoding="utf-8"))
            print("Seeded Maya 32000001 and Leo 32000002. No login passwords created.")
        elif args.action == "assign":
            user = db.execute(
                'SELECT id FROM "user" WHERE id=%s OR "studentId"=%s',
                (args.user_id, args.student_id),
            ).fetchone()
            if not user:
                raise SystemExit("Student account not found.")
            for code in args.courses:
                if not db.execute(
                    'SELECT id FROM course_class WHERE "courseCode"=%s AND "termId"=%s',
                    (code, database.term_id),
                ).fetchone():
                    raise ValueError(f"No classes for course {code} in this term.")
                db.execute(
                    'INSERT INTO course_approval ("userId","termId","courseCode") VALUES (%s,%s,%s) ON CONFLICT DO NOTHING',
                    (user["id"], database.term_id, code),
                )
            print(f"Assigned {len(args.courses)} courses.")
        elif args.action == "capacity":
            if args.seats < 0:
                raise SystemExit("Capacity cannot be negative.")
            if (
                db.execute(
                    "UPDATE class_option SET capacity=%s WHERE id=%s", (args.seats, args.option)
                ).rowcount
                != 1
            ):
                raise ValueError("Class option not found.")
            print("Updated capacity.")
        elif args.action == "import":
            data = json.loads(args.file.read_text(encoding="utf-8"))
            capacities = data.pop("capacities", {})
            metadata = data.pop("course_metadata", {})
            validated = Catalogue.model_validate(data)
            db.execute(
                "INSERT INTO academic_term (id,name) VALUES (%s,%s) ON CONFLICT (id) DO UPDATE SET name=excluded.name",
                (database.term_id, validated.term),
            )
            for section in validated.sections:
                seats = capacities.get(section.key)
                if type(seats) is not int or seats < 0:
                    raise ValueError(
                        f"Supply a nonnegative capacity for {section.key} in capacities."
                    )
                db.execute(
                    "INSERT INTO course (code,title,credits) VALUES (%s,%s,%s) ON CONFLICT (code) DO UPDATE SET title=excluded.title,credits=excluded.credits",
                    (section.code, section.title, section.credits),
                )
                if section.code in metadata:
                    details = metadata[section.code]
                    faculty = details.get("faculty", "")
                    description = details.get("description", "")
                    if not isinstance(faculty, str) or not faculty.strip() or len(faculty) > 200:
                        raise ValueError(f"Supply a faculty name for {section.code} (1–200 characters).")
                    if not isinstance(description, str) or len(description) > 10000:
                        raise ValueError(f"Invalid description for {section.code}.")
                    db.execute(
                        'UPDATE course SET faculty=%s,description=%s WHERE code=%s',
                        (faculty.strip(), description.strip(), section.code),
                    )
                existing = db.execute(
                    'SELECT "courseCode","termId" FROM course_class WHERE id=%s', (section.group,)
                ).fetchone()
                if existing and (
                    existing["courseCode"] != section.code or existing["termId"] != database.term_id
                ):
                    raise ValueError("A class ID cannot be reassigned to another course or term.")
                db.execute(
                    'INSERT INTO course_class (id,"courseCode","termId",kind) VALUES (%s,%s,%s,%s) ON CONFLICT (id) DO UPDATE SET kind=excluded.kind',
                    (section.group, section.code, database.term_id, section.kind),
                )
                existing = db.execute(
                    'SELECT "classId" FROM class_option WHERE id=%s', (section.key,)
                ).fetchone()
                if existing and existing["classId"] != section.group:
                    raise ValueError("An option ID cannot be moved to another required class.")
                start, end = ([int(p) for p in t.split(":")] for t in [section.start, section.end])
                db.execute(
                    """INSERT INTO class_option (id,"classId",label,day,"startMinute","endMinute",room,capacity,enabled)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO UPDATE SET label=excluded.label,
                    day=excluded.day,"startMinute"=excluded."startMinute","endMinute"=excluded."endMinute",
                    room=excluded.room,capacity=excluded.capacity,enabled=excluded.enabled""",
                    (
                        section.key,
                        section.group,
                        section.section,
                        section.day,
                        start[0] * 60 + start[1],
                        end[0] * 60 + end[1],
                        section.room,
                        seats,
                        section.selectable,
                    ),
                )
            print(
                f"Imported {len(validated.sections)} time options. Existing unlisted classes are preserved."
            )
        else:
            rows = db.execute(
                """SELECT cc."courseCode",cc.kind,o.id,o.label,o.capacity,o.enabled,
                count(e."userId")::int AS occupied,greatest(0,o.capacity-count(e."userId"))::int AS remaining
                FROM class_option o JOIN course_class cc ON cc.id=o."classId"
                LEFT JOIN class_enrolment e ON e."optionId"=o.id WHERE cc."termId"=%s
                GROUP BY cc."courseCode",cc.kind,o.id ORDER BY cc."courseCode",o.id""",
                (database.term_id,),
            ).fetchall()
            print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
