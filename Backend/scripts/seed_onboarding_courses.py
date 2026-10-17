"""Add 18 explicitly fictional courses to the active PostgreSQL term.

Run without flags to validate the fixture; --apply inserts it, --check verifies it.
Existing rows, account selections, timetables and bookings are never overwritten.
"""

import argparse
import os
import sys
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from enrolment.catalogue import Catalogue  # noqa: E402
from enrolment.postgres import Database  # noqa: E402

FACULTIES = {
    "Arts": [
        (
            "ART",
            "Stories, Culture and Society",
            "Explore how stories shape identity and communities through close reading, discussion and short creative responses.",
            "Seminar",
        ),
        (
            "ART",
            "Media and Everyday Life",
            "Analyse news, social media and digital audiences, then develop a small media research project.",
            "Tutorial",
        ),
        (
            "ART",
            "Designing Public Conversations",
            "Practise interviewing, argument and public communication through collaborative workshops.",
            "Workshop",
        ),
    ],
    "Science": [
        (
            "SCI",
            "Ecology of Urban Environments",
            "Investigate urban ecosystems, biodiversity and environmental sampling using practical field-data exercises.",
            "Lab",
        ),
        (
            "SCI",
            "Chemistry of Everyday Materials",
            "Connect molecular structure with the properties of household and industrial materials through laboratory experiments.",
            "Lab",
        ),
        (
            "SCI",
            "Exploring Space and Light",
            "Study stars, planetary systems and the behaviour of light through observations and guided problem solving.",
            "Tutorial",
        ),
    ],
    "Information Technology": [
        (
            "IT",
            "Building Interactive Applications",
            "Create small accessible web applications, covering interface structure, user input and testing.",
            "Lab",
        ),
        (
            "IT",
            "Data Discovery and Visualisation",
            "Clean, explore and communicate datasets using practical analysis and visualisation techniques.",
            "Lab",
        ),
        (
            "IT",
            "Human-Centred Computing",
            "Investigate user needs and prototype digital experiences through usability studies and design workshops.",
            "Studio",
        ),
    ],
    "Engineering": [
        (
            "ENG",
            "Engineering Sustainable Systems",
            "Model energy and resource flows, compare design alternatives and develop a sustainable system concept.",
            "Workshop",
        ),
        (
            "ENG",
            "Robotics and Physical Computing",
            "Build and test simple sensor-driven systems while learning control, electronics and mechanical integration.",
            "Lab",
        ),
        (
            "ENG",
            "Structures and Materials in Practice",
            "Investigate how forces, material properties and geometry affect the performance of engineered structures.",
            "Lab",
        ),
    ],
    "Business and Economics": [
        (
            "BUS",
            "Entrepreneurship in Practice",
            "Develop a venture idea through customer research, business modelling and a practical pitch.",
            "Workshop",
        ),
        (
            "BUS",
            "Economics of Everyday Decisions",
            "Use economic models to examine choices made by households, organisations and governments.",
            "Tutorial",
        ),
        (
            "BUS",
            "Marketing and Consumer Insights",
            "Study consumer behaviour and design an evidence-based marketing proposal using research exercises.",
            "Tutorial",
        ),
    ],
    "Medicine, Nursing and Health Sciences": [
        (
            "HSC",
            "Foundations of Community Health",
            "Explore prevention, health promotion and the social factors that shape community wellbeing.",
            "Tutorial",
        ),
        (
            "HSC",
            "Human Movement and Wellbeing",
            "Examine movement, physical activity and wellbeing through introductory practical investigations.",
            "Lab",
        ),
        (
            "HSC",
            "Health Communication and Care",
            "Practise clear, respectful health communication through simulated scenarios and reflective workshops.",
            "Workshop",
        ),
    ],
}


def fixture(term_id, term_name):
    courses, classes, options, sections = [], [], [], []
    required = {}
    for faculty_index, (faculty, entries) in enumerate(FACULTIES.items()):
        for index, (prefix, title, description, practical) in enumerate(entries):
            code = f"DEMO-{prefix}{101 + index}"
            courses.append((code, title, 6, faculty, f"Fictional demo course. {description}"))
            required[code] = []
            for kind_index, kind in enumerate(["Lecture", practical]):
                class_id = (
                    f"{term_id}-{code.lower()}-{'lecture' if kind_index == 0 else 'practical'}"
                )
                classes.append((class_id, code, term_id, kind))
                required[code].append(class_id)
                for variant in range(2):
                    option_id = f"{class_id}-{variant + 1:02}"
                    label = f"{'L' if kind_index == 0 else 'P'}-{variant + 1:02}"
                    day = (faculty_index + index + kind_index * 2 + variant * 2) % 5 + 1
                    start = (9 + ((index * 2 + faculty_index + variant * 3 + kind_index) % 7)) * 60
                    end = start + (60 if kind_index == 0 else 90)
                    room = f"Demo {prefix} {'Theatre' if kind_index == 0 else practical} {101 + index * 2 + variant}"
                    options.append(
                        (
                            option_id,
                            class_id,
                            label,
                            day,
                            start,
                            end,
                            room,
                            80 if kind_index == 0 else 30,
                            True,
                        )
                    )
                    sections.append(
                        {
                            "key": option_id,
                            "group": class_id,
                            "code": code,
                            "title": title,
                            "kind": kind,
                            "section": label,
                            "day": day,
                            "start": f"{start // 60:02}:{start % 60:02}",
                            "end": f"{end // 60:02}:{end % 60:02}",
                            "room": room,
                            "credits": 6,
                        }
                    )
    Catalogue.model_validate(
        {
            "term": term_name,
            "demo": False,
            "students": {},
            "required_groups": required,
            "sections": sections,
        }
    )
    return courses, classes, options


def verify(db, courses, classes, options):
    codes = [course[0] for course in courses]
    found = db.execute(
        "SELECT code,title,credits,faculty,description FROM course WHERE code=ANY(%s)", (codes,)
    ).fetchall()
    expected = {tuple(course) for course in courses}
    actual = {
        (row["code"], row["title"], row["credits"], row["faculty"], row["description"])
        for row in found
    }
    if expected != actual:
        raise ValueError(
            "Demo course metadata differs from the fixture; existing rows were not overwritten."
        )
    groups = db.execute(
        'SELECT id,"courseCode","termId",kind FROM course_class WHERE id=ANY(%s)',
        ([row[0] for row in classes],),
    ).fetchall()
    if {tuple(row) for row in classes} != {
        (row["id"], row["courseCode"], row["termId"], row["kind"]) for row in groups
    }:
        raise ValueError("Demo required classes differ from the fixture.")
    timings = db.execute(
        'SELECT id,"classId",label,day,"startMinute","endMinute",room,capacity,enabled FROM class_option WHERE id=ANY(%s)',
        ([row[0] for row in options],),
    ).fetchall()
    if {tuple(row) for row in options} != {
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
        for row in timings
    }:
        raise ValueError("Demo class times differ from the fixture.")
    print(
        f"Verified {len(found)} courses, {len(groups)} required classes and {len(timings)} class times."
    )
    for faculty, count in sorted(Counter(row["faculty"] for row in found).items()):
        print(f"  {faculty}: {count} demo courses")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--apply", action="store_true")
    action.add_argument("--check", action="store_true")
    args = parser.parse_args()
    load_dotenv(ROOT / ".env")
    term_id = os.getenv("TERM_ID", "2026-fall")
    if not args.apply and not args.check:
        courses, classes, options = fixture(term_id, "Demo term")
        print(
            f"Validated {len(courses)} fictional courses across {len(FACULTIES)} faculties, {len(classes)} required classes, {len(options)} time options. No database changes."
        )
        return
    database = Database(os.environ["POSTGRES_URL"], term_id)
    with database.connection() as db:
        term = db.execute("SELECT name FROM academic_term WHERE id=%s", (term_id,)).fetchone()
        if not term:
            raise ValueError("The active academic term must exist before adding demo courses.")
        courses, classes, options = fixture(term_id, term["name"])
        if args.apply:
            with db.cursor() as cursor:
                cursor.executemany(
                    "INSERT INTO course (code,title,credits,faculty,description) VALUES (%s,%s,%s,%s,%s) ON CONFLICT (code) DO NOTHING",
                    courses,
                )
                cursor.executemany(
                    'INSERT INTO course_class (id,"courseCode","termId",kind) VALUES (%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING',
                    classes,
                )
                cursor.executemany(
                    'INSERT INTO class_option (id,"classId",label,day,"startMinute","endMinute",room,capacity,enabled) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING',
                    options,
                )
        verify(db, courses, classes, options)
    print("Demo courses committed." if args.apply else "Database verification complete.")


if __name__ == "__main__":
    main()
