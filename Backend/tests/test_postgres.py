"""Opt-in integration tests in a fresh disposable schema, never production rows.

RUN_POSTGRES_TESTS=1 enables these tests using POSTGRES_URL from Backend/.env.
"""

import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import psycopg
import pytest
from dotenv import dotenv_values
from psycopg import sql

from enrolment.ai import FixtureParser
from enrolment.errors import ApiError
from enrolment.models import ExtractedRule, Intent, Rule, TimetableQuery
from enrolment.postgres import Database, PostgresStore
from enrolment.service import Service

ROOT = Path(__file__).resolve().parents[1]


def seed_sql():
    # Keep the fixture's transaction-local isolated search path through all assertions.
    return (
        (ROOT / "sql/seed_maya_leo.sql")
        .read_text()
        .replace("\nBEGIN;\n", "\n")
        .replace("\nCOMMIT;\n", "\n")
    )


pytestmark = pytest.mark.skipif(
    os.getenv("RUN_POSTGRES_TESTS") != "1", reason="Opt-in PostgreSQL integration tests"
)


@pytest.fixture(scope="module")
def database():
    url = os.getenv("POSTGRES_URL") or dotenv_values(ROOT / ".env")["POSTGRES_URL"]
    schema = "planner_test_" + uuid4().hex
    with psycopg.connect(url, autocommit=True) as db:
        db.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    isolated = Database(url, "2026-fall", schema=schema)
    try:
        with isolated.connection() as db:
            db.execute("""CREATE TABLE "user" (id text PRIMARY KEY,name text NOT NULL,email text UNIQUE,
                "studentId" text UNIQUE,"emailVerified" boolean DEFAULT false,"updatedAt" timestamp DEFAULT now())""")
            db.execute(
                (
                    ROOT.parent
                    / "Frontend/prisma/migrations/20261016_database_planner/migration.sql"
                ).read_text()
            )
            db.execute(seed_sql())
        yield isolated
    finally:
        # Only the random schema created by this fixture is eligible for cleanup.
        assert schema.startswith("planner_test_") and len(schema) == 45
        with psycopg.connect(url, autocommit=True) as db:
            db.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))


@pytest.fixture
def owner(database):
    uid = "test-" + uuid4().hex
    with database.connection() as db:
        db.execute('INSERT INTO "user" (id,name) VALUES (%s,%s)', (uid, "Test Student"))
        db.execute(
            'INSERT INTO course_approval ("userId","termId","courseCode") SELECT DISTINCT %s,%s,"courseCode" FROM course_class WHERE "termId"=%s',
            (uid, database.term_id, database.term_id),
        )
    return uid


def service(database, owner, intent=None):
    parser = FixtureParser()
    if intent:
        parser.parse = lambda *args, **kwargs: intent.model_copy(deep=True)
    return Service(
        database.catalogue(owner),
        PostgresStore(database),
        parser,
        {"SOLVER_TIMEOUT_SECONDS": 3, "MAX_SOLVER_NODES": 200000, "SWAP_WINDOW_DAYS": 14},
        database,
    )


def friend(value):
    return Rule(id="friend", kind="friend", value=value, label="Match", source=str(value))


def test_class_choices_persist_across_requests_and_preserve_friend_data(database, owner):
    plan = service(database, owner).build(owner, [friend("32000001")])
    original = next(s for s in plan.sections if s.key == "writ-w01")
    choices = service(database, owner).alternatives(owner, plan.plan_id, original.key)
    full = next(o for o in choices.options if o.section.key == "writ-w99-full")
    assert not full.can_swap and full.remaining_seats == 0
    alternative = next(o for o in choices.options if o.section.key == "writ-w03")
    assert alternative.can_swap and alternative.remaining_seats > 0
    assert alternative.preference_notes
    kept = service(database, owner).keep(owner, plan.plan_id, "phil-s01", True)
    saved, _ = PostgresStore(database).get(owner, kept.plan_id)
    assert saved.kept_sections == ["phil-s01"]
    swapped = service(database, owner).swap(owner, kept.plan_id, original.key, "writ-w03")
    assert swapped.kept_sections == ["phil-s01"]
    assert swapped.friend.name == plan.friend.name and swapped.friend.shared == 7
    assert {s.key for s in swapped.sections} == {s.key for s in plan.sections} - {original.key} | {
        "writ-w03"
    }


def test_seed_is_repeatable_and_directory_resolves_names_and_ids(database, owner):
    with database.connection() as db:
        before = db.execute("SELECT count(*) AS n FROM class_enrolment").fetchone()["n"]
        db.execute(seed_sql())
        assert (
            db.execute("SELECT count(*) AS n FROM class_enrolment").fetchone()["n"] == before == 16
        )
    for reference in ["Maya", "maya okafor", "32000001", "Maya Okafor [32000001]"]:
        name, keys = database.resolve_student(reference, owner)
        assert name == "Maya Okafor [32000001]" and len(keys) == 8
    assert database.resolve_student("Leo", owner)[0] == "Leo Chen [32000002]"
    for reference in ["99999999", "Nobody", "%' OR 1=1 --"]:
        with pytest.raises(ApiError, match="No student matches"):
            database.resolve_student(reference, owner)
    with pytest.raises(ApiError, match="own account"):
        database.resolve_student("32000001", "sample-maya")
    assert database.lookup_student("32000001") == {"name": "Maya Okafor", "student_id": "32000001"}
    with pytest.raises(ApiError, match="No student matches"):
        database.lookup_student("99999999")


def test_ambiguous_name_never_guesses_and_student_without_timetable_is_clear(database, owner):
    with database.connection() as db:
        db.execute(
            'INSERT INTO "user" (id,name,"studentId") VALUES (%s,%s,%s)',
            ("duplicate-maya", "Maya Jones", "32000003"),
        )
    with pytest.raises(ApiError, match="More than one student"):
        database.resolve_student("Maya", owner)
    assert database.resolve_student("32000001", owner)[0].startswith("Maya Okafor")
    with pytest.raises(ApiError, match="no saved timetable"):
        database.resolve_student("32000003", owner)
    assert database.lookup_student("32000003") == {"name": "Maya Jones", "student_id": "32000003"}
    assert database.lookup_student("maya jones")["student_id"] == "32000003"
    with pytest.raises(ApiError, match="More than one student"):
        database.lookup_student("Maya")


def test_database_rule_and_query_resolution_and_full_option_exclusion(database, owner):
    intent = Intent(
        action="rules", rules=[ExtractedRule(kind="friend", value="32000001", source="32000001")]
    )
    parsed = service(database, owner, intent).parse(owner, "Match 32000001")
    assert parsed.rules[0].value == "Maya Okafor [32000001]"
    plan = service(database, owner).build(owner, parsed.rules)
    assert plan.friend.shared == plan.friend.total == 8
    assert "writ-w99-full" not in {s.key for s in plan.sections}
    with database.connection() as db:
        assert (
            db.execute(
                'SELECT count(*) AS n FROM class_enrolment WHERE "userId"=%s', (owner,)
            ).fetchone()["n"]
            == 0
        )
        count = db.execute("SELECT count(*) AS n FROM planner_plan").fetchone()["n"]
    intent = Intent(
        action="query",
        query=TimetableQuery(topic="friend_matches", friends=["32000002"], source="Leo"),
    )
    reply = service(database, owner, intent).adjust(owner, plan.plan_id, "Leo")
    assert not reply.changed and reply.version == plan.version
    assert "Leo Chen [32000002]: 6 matching classes" in reply.message.text
    with database.connection() as db:
        assert db.execute("SELECT count(*) AS n FROM planner_plan").fetchone()["n"] == count
    with pytest.raises(ApiError, match="not found"):
        PostgresStore(database).get("other-account", plan.plan_id)


def test_latest_saved_timetable_is_used_for_queries(database, owner):
    plan = service(database, owner).build(owner, [friend("32000001")])
    # Change the other student's saved draft without changing their confirmed seat.
    with database.connection() as db:
        db.execute(
            'UPDATE timetable_entry SET "optionId"=%s WHERE "timetableId"=%s AND "classId"=%s',
            ("phil-s02", "sample-maya:2026-fall", "phil-1100-seminar"),
        )
    try:
        intent = Intent(
            action="query",
            query=TimetableQuery(topic="friend_matches", friends=["32000001"], source="Maya"),
        )
        reply = service(database, owner, intent).adjust(owner, plan.plan_id, "Maya")
        assert "7 matching classes" in reply.message.text
    finally:
        with database.connection() as db:
            db.execute(
                'UPDATE timetable_entry SET "optionId"=%s WHERE "timetableId"=%s AND "classId"=%s',
                ("phil-s01", "sample-maya:2026-fall", "phil-1100-seminar"),
            )


@pytest.fixture
def small_course(database):
    suffix = uuid4().hex[:10]
    term, code, group = f"term-{suffix}", f"COURSE-{suffix}", f"class-{suffix}"
    users = [f"race-{suffix}-a", f"race-{suffix}-b"]
    with database.connection() as db:
        db.execute("INSERT INTO academic_term VALUES (%s,%s)", (term, "Capacity test"))
        db.execute("INSERT INTO course VALUES (%s,%s,3)", (code, "Testing"))
        db.execute("INSERT INTO course_class VALUES (%s,%s,%s,%s)", (group, code, term, "Lecture"))
        for letter, start in [("a", 600), ("b", 720)]:
            db.execute(
                'INSERT INTO class_option (id,"classId",label,day,"startMinute","endMinute",room,capacity) VALUES (%s,%s,%s,1,%s,%s,%s,1)',
                (group + letter, group, letter, start, start + 60, "Test room"),
            )
        for user in users:
            db.execute('INSERT INTO "user" (id,name) VALUES (%s,%s)', (user, "Race test"))
            db.execute("INSERT INTO course_approval VALUES (%s,%s,%s)", (user, term, code))
    return Database(database.url, term, schema=database.schema), users, group


def test_last_seat_race_idempotency_and_rebooking_are_atomic(small_course):
    db, users, group = small_course
    plans = [service(db, user).build(user, []) for user in users]
    barrier = Barrier(2)

    def confirm(index):
        current = service(db, users[index])
        barrier.wait(timeout=10)
        try:
            return index, current.confirm(users[index], plans[index].plan_id)
        except ApiError as error:
            return index, error

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(confirm, [0, 1]))
    winners = [(i, r) for i, r in results if not isinstance(r, ApiError)]
    losers = [(i, r) for i, r in results if isinstance(r, ApiError)]
    assert len(winners) == len(losers) == 1 and losers[0][1].status == 409
    winner, confirmation = winners[0]
    assert service(db, users[winner]).confirm(users[winner], plans[winner].plan_id) == confirmation
    with db.connection() as connection:
        assert (
            connection.execute(
                'SELECT count(*) AS n FROM class_enrolment WHERE "optionId"=%s', (group + "a",)
            ).fetchone()["n"]
            == 1
        )
    loser = losers[0][0]
    retry = service(db, users[loser]).build(users[loser], [])
    assert retry.sections[0].key == group + "b"
    rule = Rule(id="later", kind="earliest", value=720, label="Later", source="Later")
    replacement = service(db, users[winner]).build(users[winner], [rule])
    service(db, users[winner]).confirm(users[winner], replacement.plan_id)
    with db.connection() as connection:
        assert (
            connection.execute(
                'SELECT "optionId" FROM class_enrolment WHERE "userId"=%s', (users[winner],)
            ).fetchone()["optionId"]
            == group + "b"
        )
        assert (
            connection.execute(
                'SELECT count(*) AS n FROM class_enrolment WHERE "optionId"=%s', (group + "a",)
            ).fetchone()["n"]
            == 0
        )


def test_full_at_confirmation_rolls_back_and_database_rejects_direct_overbooking(small_course):
    db, users, group = small_course
    plan = service(db, users[0]).build(users[0], [])
    with db.connection() as connection:
        connection.execute(
            "INSERT INTO class_enrolment VALUES (%s,%s,%s)", (users[1], group, group + "a")
        )
    with pytest.raises(ApiError, match="full or closed"):
        service(db, users[0]).confirm(users[0], plan.plan_id)
    for query, parameters in [
        ("INSERT INTO class_enrolment VALUES (%s,%s,%s)", (users[0], group, group + "a")),
        ("UPDATE class_option SET capacity=0 WHERE id=%s", (group + "a",)),
    ]:
        with pytest.raises(ApiError) as caught:
            with db.connection() as connection:
                connection.execute(query, parameters)
        assert isinstance(caught.value.__cause__, psycopg.errors.CheckViolation)
    with db.connection() as connection:
        assert (
            connection.execute(
                'SELECT count(*) AS n FROM class_enrolment WHERE "userId"=%s', (users[0],)
            ).fetchone()["n"]
            == 0
        )


def test_changed_class_time_requires_new_draft(small_course):
    db, users, group = small_course
    plan = service(db, users[0]).build(users[0], [])
    with db.connection() as connection:
        connection.execute('UPDATE class_option SET "startMinute"=610 WHERE id=%s', (group + "a",))
    with pytest.raises(ApiError, match="time or room changed"):
        service(db, users[0]).confirm(users[0], plan.plan_id)


def test_admin_can_add_course_options_assign_courses_and_track_capacity(
    database, owner, monkeypatch
):
    import sys

    from scripts import catalogue_admin

    monkeypatch.setenv("POSTGRES_URL", "isolated-test-adapter")
    monkeypatch.setattr(catalogue_admin, "Database", lambda *args: database)
    monkeypatch.setattr(
        sys,
        "argv",
        ["catalogue_admin", "import", str(ROOT / "data/additional_course.example.json")],
    )
    catalogue_admin.main()
    monkeypatch.setattr(sys, "argv", ["catalogue_admin", "assign", "--user-id", owner, "COMP 1000"])
    catalogue_admin.main()
    plan = service(database, owner).build(owner, [])
    assert len(plan.sections) == 10
    assert len([s for s in plan.sections if s.code == "COMP 1000"]) == 2
    assert "comp-b02" not in {s.key for s in plan.sections}
    monkeypatch.setattr(sys, "argv", ["catalogue_admin", "capacity", "comp-l01", "0"])
    catalogue_admin.main()
    plan = service(database, owner).build(owner, [])
    assert "comp-l02" in {s.key for s in plan.sections} and "comp-l01" not in {
        s.key for s in plan.sections
    }
