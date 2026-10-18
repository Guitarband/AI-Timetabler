import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from .errors import ApiError
from .models import Confirmation, Plan


class Store:
    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS families (
                    id TEXT PRIMARY KEY, owner TEXT NOT NULL, head TEXT NOT NULL,
                    confirmation TEXT
                );
                CREATE TABLE IF NOT EXISTS plans (
                    id TEXT PRIMARY KEY, family TEXT NOT NULL REFERENCES families(id),
                    parent TEXT REFERENCES plans(id), body TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS families_owner ON families(owner);
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            yield db
        finally:
            db.close()

    @staticmethod
    def row(db, owner: str, plan_id: str):
        row = db.execute(
            """
            SELECT p.*, f.head, f.confirmation FROM plans p
            JOIN families f ON f.id = p.family WHERE p.id = ? AND f.owner = ?
        """,
            (plan_id, owner),
        ).fetchone()
        if row is None:
            raise ApiError(404, "This plan was not found for your account. Build a new timetable.")
        return row

    def get(self, owner: str, plan_id: str, *, editable: bool = False):
        with self.connection() as db:
            row = self.row(db, owner, plan_id)
            if editable:
                self.check_editable(row, plan_id)
            return Plan.model_validate_json(row["body"]), row["parent"]

    @staticmethod
    def check_editable(row, plan_id):
        if row["confirmation"]:
            raise ApiError(
                409, "This plan is already confirmed. Build a new draft to make changes."
            )
        if row["head"] != plan_id:
            raise ApiError(
                409, "This draft has a newer version. Use the latest plan or build a new one."
            )

    def save(self, owner: str, plan: Plan, previous_id: str | None = None):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if previous_id:
                old = self.row(db, owner, previous_id)
                self.check_editable(old, previous_id)
                family = old["family"]
                db.execute("UPDATE families SET head = ? WHERE id = ?", (plan.plan_id, family))
            else:
                family = uuid4().hex
                db.execute(
                    "INSERT INTO families VALUES (?, ?, ?, NULL)", (family, owner, plan.plan_id)
                )
            db.execute(
                "INSERT INTO plans VALUES (?, ?, ?, ?)",
                (plan.plan_id, family, previous_id, plan.model_dump_json(exclude_none=True)),
            )
            db.commit()

    def fork_confirmed(self, owner, plan_id, make_draft):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = self.row(db, owner, plan_id)
            if not row["confirmation"] or row["head"] != plan_id:
                raise ApiError(409, "Only the confirmed version can be reopened for editing.")
            plan = make_draft(Plan.model_validate_json(row["body"]))
            family = uuid4().hex
            db.execute("INSERT INTO families VALUES (?, ?, ?, NULL)", (family, owner, plan.plan_id))
            db.execute(
                "INSERT INTO plans VALUES (?, ?, NULL, ?)",
                (plan.plan_id, family, plan.model_dump_json(exclude_none=True)),
            )
            db.commit()
            return plan

    def confirm(self, owner: str, plan_id: str, make_confirmation):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = self.row(db, owner, plan_id)
            if row["head"] != plan_id:
                raise ApiError(409, "This draft has a newer version. Confirm the latest plan.")
            if row["confirmation"]:
                result = Confirmation.model_validate(json.loads(row["confirmation"]))
            else:
                result = make_confirmation(Plan.model_validate_json(row["body"]))
                db.execute(
                    "UPDATE families SET confirmation = ? WHERE id = ?",
                    (result.model_dump_json(exclude_none=True), row["family"]),
                )
            db.commit()
            return result
