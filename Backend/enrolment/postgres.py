"""PostgreSQL adapters for the Prisma-owned catalogue, directory and planner tables."""

import logging
import re
from contextlib import contextmanager
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .catalogue import Catalogue, Profile
from .errors import ApiError, SelfMatchError
from .models import Confirmation, Plan, PublishedSection
from .storage import Store

logger = logging.getLogger(__name__)


class Database:
    def __init__(self, url, term_id, *, schema=None):
        self.url, self.term_id = url, term_id
        self.schema = schema

    @contextmanager
    def connection(self):
        try:
            with psycopg.connect(self.url, row_factory=dict_row, connect_timeout=5) as db:
                if self.schema:
                    db.execute(
                        sql.SQL("SET LOCAL search_path TO {}").format(sql.Identifier(self.schema))
                    )
                db.execute("SET LOCAL statement_timeout = '8000ms'")
                yield db
        except psycopg.errors.CheckViolation as error:
            logger.warning("PostgreSQL rejected a constraint (%s)", type(error).__name__)
            raise ApiError(
                409,
                "The database rejected this change: check class capacity and valid class times.",
            ) from error
        except psycopg.Error as error:
            logger.error("PostgreSQL operation failed (%s)", type(error).__name__)
            raise ApiError(503, "Timetable database is unavailable. Please retry.") from error

    def catalogue(self, owner):
        with self.connection() as db:
            term = db.execute(
                "SELECT name FROM academic_term WHERE id=%s", (self.term_id,)
            ).fetchone()
            approvals = db.execute(
                'SELECT "courseCode" FROM course_approval WHERE "userId"=%s AND "termId"=%s ORDER BY "courseCode"',
                (owner, self.term_id),
            ).fetchall()
            if not term or not approvals:
                raise ApiError(
                    404,
                    "No courses are assigned to your account for this term. Ask the prototype administrator to assign courses.",
                )
            classes = db.execute(
                """SELECT cc.*, c.title, c.credits FROM course_class cc JOIN course c ON c.code=cc."courseCode"
                   WHERE cc."termId"=%s AND cc."courseCode"=ANY(%s) ORDER BY cc.id""",
                (self.term_id, [r["courseCode"] for r in approvals]),
            ).fetchall()
            rows = db.execute(
                """SELECT o.*, count(e."userId")::int AS occupied,
                   coalesce(bool_or(e."userId"=%s),false) AS own_seat
                   FROM class_option o LEFT JOIN class_enrolment e ON e."optionId"=o.id
                   WHERE o."classId"=ANY(%s) GROUP BY o.id ORDER BY o.id""",
                (owner, [r["id"] for r in classes]),
            ).fetchall()
        required = {r["courseCode"]: [] for r in approvals}
        by_class = {r["id"]: r for r in classes}
        for row in classes:
            required[row["courseCode"]].append(row["id"])
        sections = []
        for row in rows:
            group = by_class[row["classId"]]
            sections.append(
                PublishedSection(
                    key=row["id"],
                    code=group["courseCode"],
                    title=group["title"],
                    kind=group["kind"],
                    section=row["label"],
                    group=group["id"],
                    day=row["day"],
                    start=f"{row['startMinute'] // 60:02}:{row['startMinute'] % 60:02}",
                    end=f"{row['endMinute'] // 60:02}:{row['endMinute'] % 60:02}",
                    room=row["room"],
                    credits=group["credits"],
                    selectable=row["enabled"]
                    and (row["occupied"] < row["capacity"] or row["own_seat"]),
                    remaining_seats=max(0, row["capacity"] - row["occupied"]),
                )
            )
        published_groups = {s.group for s in sections}
        if not sections or any(
            not groups or not set(groups) <= published_groups for groups in required.values()
        ):
            raise ApiError(
                422,
                "Some assigned courses have no published classes. Ask the administrator to complete the catalogue.",
            )
        return Catalogue(
            term=term["name"],
            demo=False,
            sections=sections,
            required_groups=required,
            students={owner: Profile(approved_courses=list(required))},
        )

    def enrolled_sections(self, owner):
        with self.connection() as db:
            rows = db.execute(
                'SELECT e."optionId" FROM class_enrolment e JOIN course_class cc ON cc.id=e."classId" WHERE e."userId"=%s AND cc."termId"=%s ORDER BY e."optionId"',
                (owner, self.term_id),
            ).fetchall()
        return {row["optionId"] for row in rows}

    @staticmethod
    def find_student(db, reference):
        """Resolve a unique account without requiring a saved timetable."""
        value = str(reference).strip()
        canonical_id = re.search(r"\[([0-9]{6,12})\]$", value)
        student_id = canonical_id.group(1) if canonical_id else value
        if re.fullmatch(r"[0-9]{6,12}", student_id):
            rows = db.execute(
                'SELECT id,name,"studentId" FROM "user" WHERE "studentId"=%s', (student_id,)
            ).fetchall()
        else:
            rows = db.execute(
                'SELECT id,name,"studentId" FROM "user" WHERE "studentId" IS NOT NULL AND lower(name)=lower(%s) ORDER BY id LIMIT 6',
                (value,),
            ).fetchall()
            if not rows:
                # Escape SQL wildcards: typed names are data, not search patterns.
                prefix = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + " %"
                rows = db.execute(
                    'SELECT id,name,"studentId" FROM "user" WHERE "studentId" IS NOT NULL AND name ILIKE %s ORDER BY name,id LIMIT 6',
                    (prefix,),
                ).fetchall()
        if not rows:
            raise ApiError(422, f"No student matches ‘{value}’. Check their name or student ID.")
        if len(rows) != 1:
            choices = "; ".join(f"{r['name']} [{r['studentId']}]" for r in rows[:5])
            raise ApiError(
                422, f"More than one student matches ‘{value}’. Use a student ID: {choices}."
            )
        student = rows[0]
        return student

    def lookup_student(self, reference):
        """Prototype directory response: name and student ID only, including self lookup."""
        with self.connection() as db:
            student = self.find_student(db, reference)
        return {"name": student["name"], "student_id": student["studentId"]}

    def resolve_student(self, reference, owner):
        """Resolve a matching target and their saved timetable in the active term."""
        with self.connection() as db:
            student = self.find_student(db, reference)
            if student["id"] == owner:
                value = str(reference).strip()
                by_id = re.fullmatch(r"[0-9]{6,12}", value) or re.search(
                    r"\[([0-9]{6,12})\]$", value
                )
                raise SelfMatchError("student ID" if by_id else "student name")
            # The account library is the user's selected saved timetable. Prefer its
            # owned planner record, while still supporting imported snapshots whose
            # planner record predates PostgreSQL persistence.
            saved = db.execute(
                """SELECT COALESCE(p.body->'sections', s.snapshot #> '{plan,sections}') AS sections
                   FROM timetable_library l
                   JOIN saved_timetable s
                     ON s."userId"=l."userId" AND s.mode=l.mode AND s.id=l."activeId"
                   LEFT JOIN planner_plan p ON p.id=(s.snapshot #>> '{plan,plan_id}')
                   LEFT JOIN plan_family f ON f.id=p."familyId"
                   WHERE l."userId"=%s AND l.mode='real'
                     AND s.snapshot->>'deleted' IS DISTINCT FROM 'true'
                     AND (p.id IS NULL OR
                       (f."ownerId"=s."userId" AND f."termId"=%s))
                     AND jsonb_typeof(
                       COALESCE(p.body->'sections', s.snapshot #> '{plan,sections}')
                     )='array'""",
                (student["id"], self.term_id),
            ).fetchone()
            keys = self.saved_section_keys(
                db, student["id"], saved["sections"] if saved else None
            )
            if keys is None:
                timetable = db.execute(
                    'SELECT id FROM student_timetable WHERE "userId"=%s AND "termId"=%s',
                    (student["id"], self.term_id),
                ).fetchone()
                if not timetable:
                    raise ApiError(
                        422,
                        f"{student['name']} has no saved timetable for this term yet.",
                    )
                entries = db.execute(
                    'SELECT "optionId" FROM timetable_entry WHERE "timetableId"=%s ORDER BY "optionId"',
                    (timetable["id"],),
                ).fetchall()
                keys = [entry["optionId"] for entry in entries]
        return f"{student['name']} [{student['studentId']}]", keys

    def saved_section_keys(self, db, owner, sections):
        """Return complete active-term sections from a saved account snapshot."""
        if not isinstance(sections, list) or not sections:
            return None
        keys = [
            section.get("key")
            for section in sections
            if isinstance(section, dict) and isinstance(section.get("key"), str)
        ]
        if len(keys) != len(sections) or len(set(keys)) != len(keys):
            return None
        selected = db.execute(
            """SELECT o.id,cc.id AS class_id
               FROM class_option o JOIN course_class cc ON cc.id=o."classId"
               WHERE o.id=ANY(%s) AND cc."termId"=%s""",
            (keys, self.term_id),
        ).fetchall()
        required = db.execute(
            """SELECT cc.id
               FROM course_class cc JOIN course_approval a
                 ON a."courseCode"=cc."courseCode" AND a."termId"=cc."termId"
               WHERE a."userId"=%s AND a."termId"=%s""",
            (owner, self.term_id),
        ).fetchall()
        if len(selected) != len(keys) or {row["class_id"] for row in selected} != {
            row["id"] for row in required
        }:
            return None
        return sorted(keys)


class PostgresStore:
    def __init__(self, database):
        self.database = database

    def row(self, db, owner, plan_id, *, lock=False):
        row = db.execute(
            """SELECT p.body,p."parentId" AS parent,f.id AS family,f.head,f.confirmation
               FROM planner_plan p JOIN plan_family f ON f.id=p."familyId"
               WHERE p.id=%s AND f."ownerId"=%s AND f."termId"=%s"""
            + (" FOR UPDATE OF f" if lock else ""),
            (plan_id, owner, self.database.term_id),
        ).fetchone()
        if not row:
            raise ApiError(404, "This plan was not found for your account. Build a new timetable.")
        return row

    def get(self, owner, plan_id, *, editable=False):
        with self.database.connection() as db:
            row = self.row(db, owner, plan_id)
            if editable:
                Store.check_editable(row, plan_id)
            return Plan.model_validate(row["body"]), row["parent"]

    @staticmethod
    def lock_owner(db, owner):
        if not db.execute('SELECT id FROM "user" WHERE id=%s FOR UPDATE', (owner,)).fetchone():
            raise ApiError(404, "Student account not found.")

    def publish(self, db, owner, plan):
        timetable_id = f"{owner}:{self.database.term_id}"
        row = db.execute(
            """INSERT INTO student_timetable (id,"userId","termId","planId","updatedAt") VALUES (%s,%s,%s,%s,now())
               ON CONFLICT ("userId","termId") DO UPDATE SET "planId"=excluded."planId","updatedAt"=now() RETURNING id""",
            (timetable_id, owner, self.database.term_id, plan.plan_id),
        ).fetchone()
        timetable_id = row["id"]
        db.execute('DELETE FROM timetable_entry WHERE "timetableId"=%s', (timetable_id,))
        for section in plan.sections:
            db.execute(
                """INSERT INTO timetable_entry ("timetableId","termId","classId","optionId")
                   SELECT %s,%s,"classId",id FROM class_option WHERE id=%s""",
                (timetable_id, self.database.term_id, section.key),
            )

    def save(self, owner, plan, previous_id=None):
        with self.database.connection() as db:
            self.lock_owner(db, owner)
            keys = [s.key for s in plan.sections]
            db.execute(
                "SELECT id FROM class_option WHERE id=ANY(%s) ORDER BY id FOR UPDATE", (keys,)
            ).fetchall()
            options = db.execute(
                """SELECT o.id,o.enabled,o.capacity,
                (SELECT count(*) FROM class_enrolment e WHERE e."optionId"=o.id AND e."userId"<>%s) AS occupied
                FROM class_option o WHERE o.id=ANY(%s)""",
                (owner, keys),
            ).fetchall()
            if len(options) != len(keys) or any(
                not o["enabled"] or o["occupied"] >= o["capacity"] for o in options
            ):
                raise ApiError(
                    409,
                    "Class availability changed while building your draft. Try again; no seats were reserved.",
                )
            if previous_id:
                old = self.row(db, owner, previous_id, lock=True)
                Store.check_editable(old, previous_id)
                family = old["family"]
                db.execute("UPDATE plan_family SET head=%s WHERE id=%s", (plan.plan_id, family))
            else:
                family = uuid4().hex
                db.execute(
                    'INSERT INTO plan_family (id,"ownerId","termId",head) VALUES (%s,%s,%s,%s)',
                    (family, owner, self.database.term_id, plan.plan_id),
                )
            db.execute(
                'INSERT INTO planner_plan (id,"familyId","parentId",body) VALUES (%s,%s,%s,%s)',
                (plan.plan_id, family, previous_id, Jsonb(plan.model_dump(exclude_none=True))),
            )
            self.publish(db, owner, plan)

    def fork_confirmed(self, owner, plan_id, make_draft):
        with self.database.connection() as db:
            self.lock_owner(db, owner)
            row = self.row(db, owner, plan_id, lock=True)
            if not row["confirmation"] or row["head"] != plan_id:
                raise ApiError(409, "Only the confirmed version can be reopened for editing.")
            plan = make_draft(Plan.model_validate(row["body"]))
            family = uuid4().hex
            db.execute(
                'INSERT INTO plan_family (id,"ownerId","termId",head) VALUES (%s,%s,%s,%s)',
                (family, owner, self.database.term_id, plan.plan_id),
            )
            db.execute(
                'INSERT INTO planner_plan (id,"familyId","parentId",body) VALUES (%s,%s,NULL,%s)',
                (plan.plan_id, family, Jsonb(plan.model_dump(exclude_none=True))),
            )
            # Reopening is a copy, not a booking or publication. Existing seats stay held.
            return plan

    def confirm(self, owner, plan_id, make_confirmation):
        with self.database.connection() as db:
            self.lock_owner(db, owner)
            row = self.row(db, owner, plan_id, lock=True)
            if row["head"] != plan_id:
                raise ApiError(409, "This draft has a newer version. Confirm the latest plan.")
            if row["confirmation"]:
                return Confirmation.model_validate(row["confirmation"])
            plan = Plan.model_validate(row["body"])
            keys = [s.key for s in plan.sections]
            old = db.execute(
                """SELECT e."optionId" FROM class_enrolment e JOIN course_class cc ON cc.id=e."classId"
                                WHERE e."userId"=%s AND cc."termId"=%s""",
                (owner, self.database.term_id),
            ).fetchall()
            # All writers lock options in the same order before counting or changing seats.
            db.execute(
                "SELECT id FROM class_option WHERE id=ANY(%s) ORDER BY id FOR UPDATE",
                (sorted(set(keys) | {r["optionId"] for r in old}),),
            ).fetchall()
            options = db.execute(
                """SELECT o.*,cc."courseCode",cc."termId",
                (SELECT count(*) FROM class_enrolment e WHERE e."optionId"=o.id AND e."userId"<>%s) AS occupied
                FROM class_option o JOIN course_class cc ON cc.id=o."classId" WHERE o.id=ANY(%s)""",
                (owner, keys),
            ).fetchall()
            required = db.execute(
                """SELECT cc.id FROM course_class cc JOIN course_approval a
                ON a."courseCode"=cc."courseCode" AND a."termId"=cc."termId"
                WHERE a."userId"=%s AND a."termId"=%s""",
                (owner, self.database.term_id),
            ).fetchall()
            if (
                len(options) != len(keys)
                or len({o["classId"] for o in options}) != len(keys)
                or {o["classId"] for o in options} != {r["id"] for r in required}
            ):
                raise ApiError(
                    409, "Your assigned courses or classes changed. Build a new timetable."
                )
            for option in options:
                if not option["enabled"] or option["occupied"] >= option["capacity"]:
                    raise ApiError(
                        409,
                        f"{option['courseCode']} {option['label']} is full or closed. Rebuild or adjust your draft; no seats were booked.",
                    )
                section = next(s for s in plan.sections if s.key == option["id"])
                if (
                    section.day != option["day"]
                    or section.start
                    != f"{option['startMinute'] // 60:02}:{option['startMinute'] % 60:02}"
                    or section.end
                    != f"{option['endMinute'] // 60:02}:{option['endMinute'] % 60:02}"
                    or section.room != option["room"]
                ):
                    raise ApiError(
                        409,
                        "A class time or room changed. Build a new timetable before confirming.",
                    )
            db.execute(
                """DELETE FROM class_enrolment e USING course_class cc
                WHERE e."classId"=cc.id AND e."userId"=%s AND cc."termId"=%s""",
                (owner, self.database.term_id),
            )
            for option in options:
                db.execute(
                    'INSERT INTO class_enrolment ("userId","classId","optionId") VALUES (%s,%s,%s)',
                    (owner, option["classId"], option["id"]),
                )
            result = make_confirmation(plan)
            result.message.steps = [
                "Checked current capacity and booked prototype seats in PostgreSQL."
            ]
            result.message.note = (
                "Prototype database booking only; no university enrolment was submitted."
            )
            db.execute(
                "UPDATE plan_family SET confirmation=%s WHERE id=%s",
                (Jsonb(result.model_dump(exclude_none=True)), row["family"]),
            )
            self.publish(db, owner, plan)
            return result
