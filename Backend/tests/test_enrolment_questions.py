from contextlib import contextmanager

import pytest

from enrolment.models import TimetableQuery
from enrolment.postgres import Database


@pytest.mark.parametrize(
    "text",
    [
        "What classes am I enrolled in",
        "What courses am I enrolled in?",
        "Which units am I taking?",
        "What courses am I registered for?",
    ],
)
def test_enrolment_question_before_build_lists_selected_courses(client, headers, text):
    result = client.post("/parse", headers=headers, json={"text": text})
    assert result.status_code == 200
    assert result.json["rules"] == [] and not result.json["ready_to_build"]
    assert "selected courses" in result.json["message"]["text"]
    assert "PSYC 1010" in result.json["message"]["text"]
    assert "not been allocated" in result.json["message"]["text"]


def test_enrolment_question_does_not_mutate_draft(app, client, headers, draft):
    result = client.post(
        "/adjust",
        headers=headers,
        json={"plan_id": draft["plan_id"], "text": "What classes am I enrolled in"},
    )
    assert result.status_code == 200
    assert not result.json["changed"]
    assert result.json["rules"] == draft["rules"]
    assert result.json["sections"] == draft["sections"]
    assert result.json["version"] == draft["version"]
    assert "current draft" in result.json["message"]["text"]
    assert "not confirmation" in result.json["message"]["text"]


def test_confirmed_bookings_are_distinct_from_draft_and_filter_by_day(app):
    service = app.extensions["enrolment"]

    class Directory:
        def enrolled_sections(self, owner):
            assert owner == "student-a"
            return {"phil-s01", "writ-w03"}

    service.directory = Directory()
    message = service.answer("student-a", TimetableQuery(topic="enrolment", source="question"))
    assert "confirmed classes" in message.text
    assert len(message.steps) == 2
    assert "university enrolment" in message.note
    friday = service.answer(
        "student-a", TimetableQuery(topic="enrolment", day=5, source="question")
    )
    assert len(friday.steps) == 1 and "PHIL 1100" in friday.steps[0]
    monday = service.answer(
        "student-a", TimetableQuery(topic="enrolment", day=1, source="question")
    )
    assert "No confirmed classes" in monday.text and not monday.steps


def test_enrolment_lookup_scopes_database_query_to_owner_and_term():
    database = Database("unused", "term-a")

    class Connection:
        def execute(self, sql, params):
            assert 'e."userId"=%s' in sql and 'cc."termId"=%s' in sql
            assert params == ("owner-a", "term-a")
            return self

        def fetchall(self):
            return [{"optionId": "own-option"}]

    @contextmanager
    def connection():
        yield Connection()

    database.connection = connection
    assert database.enrolled_sections("owner-a") == {"own-option"}
