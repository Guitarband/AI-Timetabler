"""Seed 16 fictional students, their course choices, restrictions and timetables.

Run without flags to validate against the live catalogue, --apply to write the
sample cohort, or --check to verify the saved records. No accounts or seat
bookings are created; the timetable records are draft examples.
"""

import argparse
import os
import re
from collections import Counter
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[1]
TERM_ID = "2026-fall"
MODE = "real"

FACULTIES = {
    "fada": "Faculty of Art, Design and Architecture",
    "arts": "Faculty of Arts",
    "business": "Faculty of Business and Economics",
    "education": "Faculty of Education",
    "engineering": "Faculty of Engineering",
    "it": "Faculty of Information Technology",
    "mnhs": "Faculty of Medicine, Nursing and Health Sciences",
    "pharmacy": "Faculty of Pharmacy and Pharmaceutical Sciences",
    "science": "Faculty of Science",
}

# Monday afternoon appointments are represented as Monday unavailable because
# the existing preference model stores whole-day restrictions, not time blocks.
PROFILES = [
    {
        "id": "sample-single-science-y3",
        "name": "Asha Menon",
        "student_id": "32000003",
        "degree": "single",
        "year": 3,
        "faculties": [FACULTIES["science"]],
        "courses": ["BIO3100", "BIO3132"],
        "restriction": "No classes after 5:00 pm.",
        "earliest": 540,
        "latest": 1020,
        "avoid": [],
    },
    {
        "id": "sample-single-fada-y2",
        "name": "Eli Chen",
        "student_id": "32000004",
        "degree": "single",
        "year": 2,
        "faculties": [FACULTIES["fada"]],
        "courses": ["AHT2135", "AHT2740"],
        "restriction": "Unavailable Tuesday and Friday.",
        "earliest": 540,
        "latest": 1080,
        "avoid": ["TUESDAY", "FRIDAY"],
    },
    {
        "id": "sample-single-mnhs-y2",
        "name": "Grace Okafor",
        "student_id": "32000005",
        "degree": "single",
        "year": 2,
        "faculties": [FACULTIES["mnhs"]],
        "courses": ["BMS2052", "BMS2062"],
        "restriction": "Recurring medical appointment Monday afternoons; keep Monday free.",
        "earliest": 540,
        "latest": 1080,
        "avoid": ["MONDAY"],
    },
    {
        "id": "sample-single-education-y2",
        "name": "Theo Martin",
        "student_id": "32000006",
        "degree": "single",
        "year": 2,
        "faculties": [FACULTIES["education"]],
        "courses": ["EDF2066", "EDF2404"],
        "restriction": "No classes before 10:00 am.",
        "earliest": 600,
        "latest": 1080,
        "avoid": [],
    },
    {
        "id": "sample-single-pharmacy-y2",
        "name": "Mia Nguyen",
        "student_id": "32000007",
        "degree": "single",
        "year": 2,
        "faculties": [FACULTIES["pharmacy"]],
        "courses": ["BPS2022", "BPS2042"],
        "restriction": "Unavailable on Fridays.",
        "earliest": 540,
        "latest": 1080,
        "avoid": ["FRIDAY"],
    },
    {
        "id": "sample-single-arts-y1",
        "name": "Noah Patel",
        "student_id": "32000008",
        "degree": "single",
        "year": 1,
        "faculties": [FACULTIES["arts"]],
        "courses": ["ATS1057", "ATS1059"],
        "restriction": "No classes before 11:00 am.",
        "earliest": 660,
        "latest": 1080,
        "avoid": [],
    },
    {
        "id": "sample-single-it-y1",
        "name": "Zoe Walker",
        "student_id": "32000009",
        "degree": "single",
        "year": 1,
        "faculties": [FACULTIES["it"]],
        "courses": ["FIT1057", "FIT1058"],
        "restriction": "Unavailable Monday and Wednesday.",
        "earliest": 540,
        "latest": 1080,
        "avoid": ["MONDAY", "WEDNESDAY"],
    },
    {
        "id": "sample-single-engineering-y1",
        "name": "Caleb Brooks",
        "student_id": "32000010",
        "degree": "single",
        "year": 1,
        "faculties": [FACULTIES["engineering"]],
        "courses": ["ENG1005", "ENG1012"],
        "restriction": "Unavailable on Thursdays.",
        "earliest": 540,
        "latest": 1050,
        "avoid": ["THURSDAY"],
    },
    {
        "id": "sample-single-business-y2",
        "name": "Isla Ahmed",
        "student_id": "32000011",
        "degree": "single",
        "year": 2,
        "faculties": [FACULTIES["business"]],
        "courses": ["ACC2100", "ACC2200"],
        "restriction": "Unavailable on Tuesdays.",
        "earliest": 540,
        "latest": 1080,
        "avoid": ["TUESDAY"],
    },
    {
        "id": "sample-single-business-y1",
        "name": "Finn Turner",
        "student_id": "32000012",
        "degree": "single",
        "year": 1,
        "faculties": [FACULTIES["business"]],
        "courses": ["ACC1001", "ECF1100"],
        "restriction": "Start after 9:30 am and finish by 4:30 pm.",
        "earliest": 570,
        "latest": 990,
        "avoid": [],
    },
    {
        "id": "sample-double-business-science-y3",
        "name": "Ruby Wilson",
        "student_id": "32000013",
        "degree": "double",
        "year": 3,
        "faculties": [FACULTIES["business"], FACULTIES["science"]],
        "courses": ["ACC3100", "BIO3082"],
        "restriction": "Unavailable Wednesdays; no classes after 5:00 pm.",
        "earliest": 540,
        "latest": 1020,
        "avoid": ["WEDNESDAY"],
    },
    {
        "id": "sample-double-fada-engineering-y2",
        "name": "Arun Singh",
        "student_id": "32000014",
        "degree": "double",
        "year": 2,
        "faculties": [FACULTIES["fada"], FACULTIES["engineering"]],
        "courses": ["AHT2135", "ECE2072"],
        "restriction": "Unavailable Thursdays; no classes after 5:00 pm.",
        "earliest": 540,
        "latest": 1020,
        "avoid": ["THURSDAY"],
    },
    {
        "id": "sample-double-mnhs-pharmacy-y2",
        "name": "Ava Kim",
        "student_id": "32000015",
        "degree": "double",
        "year": 2,
        "faculties": [FACULTIES["mnhs"], FACULTIES["pharmacy"]],
        "courses": ["BMS2062", "BPS2032"],
        "restriction": "Recurring Monday medical appointment; keep Monday free and start after 10:00 am.",
        "earliest": 600,
        "latest": 1080,
        "avoid": ["MONDAY"],
    },
    {
        "id": "sample-double-education-business-y2",
        "name": "Luca Garcia",
        "student_id": "32000016",
        "degree": "double",
        "year": 2,
        "faculties": [FACULTIES["education"], FACULTIES["business"]],
        "courses": ["EDF2404", "ACC2200"],
        "restriction": "Unavailable Tuesdays; no classes after 5:00 pm.",
        "earliest": 540,
        "latest": 1020,
        "avoid": ["TUESDAY"],
    },
    {
        "id": "sample-double-arts-it-y1",
        "name": "Maya Clarke",
        "student_id": "32000017",
        "degree": "double",
        "year": 1,
        "faculties": [FACULTIES["arts"], FACULTIES["it"]],
        "courses": ["ATS1044", "FIT1058"],
        "restriction": "Unavailable Fridays; no classes before 10:00 am.",
        "earliest": 600,
        "latest": 1080,
        "avoid": ["FRIDAY"],
    },
    {
        "id": "sample-double-fada-business-y1",
        "name": "Sam Reed",
        "student_id": "32000018",
        "degree": "double",
        "year": 1,
        "faculties": [FACULTIES["fada"], FACULTIES["business"]],
        "courses": ["AHT1101", "ETF1100"],
        "restriction": "Unavailable Wednesdays and Fridays; no classes after 5:00 pm.",
        "earliest": 540,
        "latest": 1020,
        "avoid": ["WEDNESDAY", "FRIDAY"],
    },
]

DAY_NUMBER = {
    "MONDAY": 1,
    "TUESDAY": 2,
    "WEDNESDAY": 3,
    "THURSDAY": 4,
    "FRIDAY": 5,
}


def validate_profiles():
    ids = [profile["id"] for profile in PROFILES]
    student_ids = [profile["student_id"] for profile in PROFILES]
    if len(PROFILES) != 16 or len(set(ids)) != 16 or len(set(student_ids)) != 16:
        raise ValueError("The cohort must have 16 unique sample users and student IDs.")
    counts = Counter((profile["degree"], profile["year"]) for profile in PROFILES)
    expected = {
        ("single", 1): 4,
        ("single", 2): 5,
        ("single", 3): 1,
        ("double", 1): 2,
        ("double", 2): 3,
        ("double", 3): 1,
    }
    if counts != expected:
        raise ValueError(f"Unexpected degree/year distribution: {counts}.")
    for profile in PROFILES:
        if len(profile["faculties"]) != (1 if profile["degree"] == "single" else 2):
            raise ValueError(f"Invalid faculty count for {profile['id']}.")
        if len(profile["courses"]) != 2 or len(set(profile["courses"])) != 2:
            raise ValueError(f"Each sample student must take two distinct units: {profile['id']}.")
        if any(day not in DAY_NUMBER for day in profile["avoid"]):
            raise ValueError(f"Unknown unavailable day for {profile['id']}.")
    return counts


def load_options(db):
    codes = sorted({code for profile in PROFILES for code in profile["courses"]})
    course_rows = db.execute(
        'SELECT code,faculty,"isCatalogueActive" FROM course WHERE code=ANY(%s)',
        (codes,),
    ).fetchall()
    courses = {row["code"]: row for row in course_rows}
    if set(courses) != set(codes):
        missing = sorted(set(codes) - set(courses))
        raise ValueError(f"Sample units are missing from the database: {missing}.")

    rows = db.execute(
        '''SELECT cc."courseCode",cc.id AS "classId",cc.kind,o.id AS "optionId",
                  o.day,o."startMinute",o."endMinute",o.room,o.enabled
           FROM course_class cc JOIN class_option o ON o."classId"=cc.id
           WHERE cc."termId"=%s AND cc."courseCode"=ANY(%s)
           ORDER BY cc."courseCode",cc.kind''',
        (TERM_ID, codes),
    ).fetchall()
    options = {}
    for row in rows:
        options.setdefault(row["courseCode"], []).append(row)

    for profile in PROFILES:
        actual_faculties = set()
        for code in profile["courses"]:
            course = courses[code]
            if not course["isCatalogueActive"]:
                raise ValueError(f"Sample unit is not active: {code}.")
            actual_faculties.add(course["faculty"])
            year_match = re.search(r"\d", code)
            if not year_match or int(year_match.group()) != profile["year"]:
                raise ValueError(f"Unit {code} does not match year {profile['year']}.")
            if len(options.get(code, [])) != 2:
                raise ValueError(f"Unit {code} must have two class options.")
        if actual_faculties != set(profile["faculties"]):
            raise ValueError(f"Unit faculties do not match {profile['id']} degree.")
        if profile["degree"] == "double" and len(actual_faculties) != 2:
            raise ValueError(f"Double-degree student {profile['id']} needs two faculties.")

    plans = {}
    for profile in PROFILES:
        selected = [
            option
            for code in profile["courses"]
            for option in options[code]
        ]
        if any(not row["enabled"] for row in selected):
            raise ValueError(f"A selected sample option is disabled for {profile['id']}.")
        if any(
            row["day"] in {DAY_NUMBER[day] for day in profile["avoid"]}
            or row["startMinute"] < profile["earliest"]
            or row["endMinute"] > profile["latest"]
            for row in selected
        ):
            raise ValueError(f"A sample timetable violates {profile['id']}'s restrictions.")
        for index, first in enumerate(selected):
            for second in selected[index + 1 :]:
                if (
                    first["day"] == second["day"]
                    and first["startMinute"] < second["endMinute"]
                    and second["startMinute"] < first["endMinute"]
                ):
                    raise ValueError(
                        f"Sample timetable clash for {profile['id']}: "
                        f"{first['optionId']} and {second['optionId']}."
                    )
        plans[profile["id"]] = selected
    return courses, plans


def verify_existing_ids(db):
    ids = [profile["id"] for profile in PROFILES]
    emails = [f"{profile['id']}@example.invalid" for profile in PROFILES]
    student_ids = [profile["student_id"] for profile in PROFILES]
    conflicts = db.execute(
        '''SELECT id,"studentId",email FROM "user"
           WHERE id=ANY(%s) OR email=ANY(%s) OR "studentId"=ANY(%s)''',
        (ids, emails, student_ids),
    ).fetchall()
    known = {profile["id"] for profile in PROFILES}
    if any(row["id"] not in known for row in conflicts):
        raise ValueError("A sample email or student ID is already used by another account.")
    existing_tables = db.execute(
        'SELECT "userId",id FROM student_timetable WHERE "userId"=ANY(%s) AND "termId"=%s',
        (ids, TERM_ID),
    ).fetchall()
    for row in existing_tables:
        expected_id = f"{row['userId']}:{TERM_ID}"
        if row["id"] != expected_id:
            raise ValueError(f"Unexpected timetable ID for sample student {row['userId']}.")


def apply(db, plans):
    with db.cursor() as cursor:
        for profile in PROFILES:
            email = f"{profile['id']}@example.invalid"
            cursor.execute(
                '''INSERT INTO "user" (id,name,email,"studentId","emailVerified","updatedAt")
                   VALUES (%s,%s,%s,%s,false,now())
                   ON CONFLICT (id) DO UPDATE SET name=excluded.name,email=excluded.email,
                     "studentId"=excluded."studentId","emailVerified"=false,"updatedAt"=now()''',
                (profile["id"], profile["name"], email, profile["student_id"]),
            )
            cursor.executemany(
                'INSERT INTO course_approval ("userId","termId","courseCode") VALUES (%s,%s,%s) ON CONFLICT DO NOTHING',
                [(profile["id"], TERM_ID, code) for code in profile["courses"]],
            )
            cursor.execute(
                '''INSERT INTO course_onboarding ("userId",mode,"termId","courseCodes","updatedAt")
                   VALUES (%s,%s,%s,%s,now())
                   ON CONFLICT ("userId",mode,"termId") DO UPDATE
                   SET "courseCodes"=excluded."courseCodes","updatedAt"=now()''',
                (profile["id"], MODE, TERM_ID, sorted(profile["courses"])),
            )
            timetable_id = f"{profile['id']}:{TERM_ID}"
            cursor.execute(
                '''INSERT INTO student_timetable (id,"userId","termId","planId","updatedAt")
                   VALUES (%s,%s,%s,NULL,now()) ON CONFLICT ("userId","termId") DO NOTHING''',
                (timetable_id, profile["id"], TERM_ID),
            )
            cursor.executemany(
                '''INSERT INTO timetable_entry ("timetableId","termId","classId","optionId")
                   VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING''',
                [
                    (timetable_id, TERM_ID, row["classId"], row["optionId"])
                    for row in plans[profile["id"]]
                ],
            )
            cursor.execute(
                '''INSERT INTO timetable_preference
                     ("userId","earliestStartMinute","latestEndMinute","preferredDays",
                      "avoidedDays","maxCampusDays","prioritizeFriends","updatedAt")
                   VALUES (%s,%s,%s,%s::"Weekday"[],%s::"Weekday"[],NULL,false,now())
                   ON CONFLICT ("userId") DO UPDATE SET
                     "earliestStartMinute"=excluded."earliestStartMinute",
                     "latestEndMinute"=excluded."latestEndMinute",
                     "preferredDays"=excluded."preferredDays",
                     "avoidedDays"=excluded."avoidedDays",
                     "maxCampusDays"=NULL,"prioritizeFriends"=false,"updatedAt"=now()''',
                (
                    profile["id"],
                    profile["earliest"],
                    profile["latest"],
                    [],
                    profile["avoid"],
                ),
            )


def verify_saved(db, plans):
    for profile in PROFILES:
        user_id = profile["id"]
        timetable_id = f"{user_id}:{TERM_ID}"
        expected_codes = sorted(profile["courses"])
        approvals = db.execute(
            'SELECT "courseCode" FROM course_approval WHERE "userId"=%s AND "termId"=%s',
            (user_id, TERM_ID),
        ).fetchall()
        onboarding = db.execute(
            'SELECT "courseCodes" FROM course_onboarding WHERE "userId"=%s AND mode=%s AND "termId"=%s',
            (user_id, MODE, TERM_ID),
        ).fetchone()
        timetable = db.execute(
            'SELECT id FROM student_timetable WHERE "userId"=%s AND "termId"=%s',
            (user_id, TERM_ID),
        ).fetchone()
        entries = db.execute(
            '''SELECT te."classId",te."optionId" FROM timetable_entry te
               WHERE te."timetableId"=%s AND te."termId"=%s''',
            (timetable_id, TERM_ID),
        ).fetchall()
        preference = db.execute(
            '''SELECT "earliestStartMinute","latestEndMinute","avoidedDays"
               FROM timetable_preference WHERE "userId"=%s''',
            (user_id,),
        ).fetchone()
        expected_entries = {
            (row["classId"], row["optionId"]) for row in plans[user_id]
        }
        if (
            sorted(row["courseCode"] for row in approvals) != expected_codes
            or onboarding is None
            or sorted(onboarding["courseCodes"]) != expected_codes
            or timetable is None
            or timetable["id"] != timetable_id
            or {(row["classId"], row["optionId"]) for row in entries} != expected_entries
            or preference is None
            or preference["earliestStartMinute"] != profile["earliest"]
            or preference["latestEndMinute"] != profile["latest"]
            or {
                day
                for day in preference["avoidedDays"].strip("{}").split(",")
                if day
            }
            != set(profile["avoid"])
        ):
            raise ValueError(f"Saved sample student data differs from the fixture: {user_id}.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--apply", action="store_true", help="Write the sample cohort")
    action.add_argument("--check", action="store_true", help="Verify saved sample records")
    args = parser.parse_args()
    counts = validate_profiles()
    load_dotenv(ROOT / ".env")
    with psycopg.connect(os.environ["POSTGRES_URL"], row_factory=dict_row) as db:
        term = db.execute("SELECT id FROM academic_term WHERE id=%s", (TERM_ID,)).fetchone()
        if not term:
            raise ValueError(f"Academic term {TERM_ID} is missing.")
        verify_existing_ids(db)
        _, plans = load_options(db)
        if args.apply:
            apply(db, plans)
        verify_saved(db, plans) if args.check else None
    print(
        f"Validated {len(PROFILES)} sample students: "
        f"10 single-faculty ({counts[('single', 1)]} first-year, "
        f"{counts[('single', 2)]} second-year, {counts[('single', 3)]} third-year) and "
        f"6 double-degree ({counts[('double', 1)]} first-year, "
        f"{counts[('double', 2)]} second-year, {counts[('double', 3)]} third-year)."
    )
    print("Each timetable has two units and four non-clashing class meetings.")
    print("Each timetable satisfies its student's day and time restrictions.")
    if args.apply:
        print("Sample cohort committed to PostgreSQL.")
    elif args.check:
        print("Sample cohort database check complete.")
    else:
        print("No database changes.")


if __name__ == "__main__":
    main()
