import json

import pytest
from pydantic import ValidationError

from enrolment.models import Intent, TimetableQuery
from tests.test_ai import parser


def ask(app, draft, topic, **filters):
    service = app.extensions["enrolment"]
    service.parser.parse = lambda *args, **kwargs: Intent(
        action="query", query=TimetableQuery(topic=topic, source="question", **filters)
    )
    result = service.adjust("student-a", draft["plan_id"], "question")
    assert not result.changed
    assert result.plan_id == draft["plan_id"] and result.version == draft["version"]
    for field in ["sections", "rules", "scores", "match_pct", "friends"]:
        assert result.model_dump()[field] == draft[field]
    stored, _ = service.store.get("student-a", result.plan_id, editable=True)
    assert stored.model_dump(exclude_none=True) == draft
    return result.message.text + "\n" + "\n".join(result.message.steps)


def test_friend_question_reports_actual_matches_without_mutating_or_saving(app, draft):
    def forbid_save(*args, **kwargs):
        raise AssertionError("A question must never save a new plan")

    app.extensions["enrolment"].store.save = forbid_save
    text = ask(app, draft, "friend_matches", friends=["Maya"])
    assert "Maya Okafor: 2 matching classes" in text
    assert "PSYC 1010 lecture L-02 on Monday 10:00" in text
    assert "STAT 2010 lecture L-01 on Tuesday 11:00" in text
    assert "PHIL 1100" not in text


def test_day_scoped_query_does_not_broaden_to_other_days(app, draft):
    text = ask(app, draft, "friend_matches", friends=["Maya Okafor"], day=3)
    assert "0 matching classes on Wednesday" in text
    assert "PSYC 1010" not in text
    text = ask(app, draft, "schedule", day=3)
    assert "Wednesday" in text and "WRIT 1000" in text and "Studio 2" in text
    assert "STAT 2010" not in text


def test_query_never_uses_revoked_or_other_account_friend_data(app, draft):
    service = app.extensions["enrolment"]
    service.catalogue.students["student-a"] = service.catalogue.profile("student-a").model_copy(
        update={"friends": {}}
    )
    text = ask(app, draft, "friend_matches", friends=["Maya Okafor"])
    assert "no uniquely identified shared timetable" in text
    assert "PSYC 1010" not in text


def test_query_handles_unselected_shared_friend_and_ambiguous_name(app, draft):
    text = ask(app, draft, "friend_matches", friends=["Leo Chen"])
    assert "Leo Chen: 2 matching classes" in text
    service = app.extensions["enrolment"]
    service.catalogue.demo_profile.friends["Maya Lee"] = ["phil-s02"]
    text = ask(app, draft, "friend_matches", friends=["Maya"])
    assert "Use the full name" in text and "matching classes" not in text


@pytest.mark.parametrize(
    "topic,filters,expected",
    [
        ("preferences", {}, "89%"),
        ("summary", {}, "5 courses, 8 classes, 15 credits"),
        ("schedule", {"day": 5}, "no classes on Friday"),
        ("alternatives", {"section_key": "phil-s02"}, "Friday 09:00"),
        ("schedule", {"course": "UNKNOWN"}, "not in your current draft"),
        ("schedule", {"section_key": "invented"}, "not in your current draft"),
    ],
)
def test_general_questions_are_grounded(app, draft, topic, filters, expected):
    assert expected in ask(app, draft, topic, **filters)


def test_help_before_build_does_not_get_misread_as_rules(app, client, headers):
    service = app.extensions["enrolment"]
    service.parser.parse = lambda *args, **kwargs: Intent(
        action="query", query=TimetableQuery(topic="help", source="help")
    )
    response = client.post("/parse", headers=headers, json={"text": "help"})
    assert response.status_code == 200 and response.json["rules"] == []
    assert "answer questions" in response.json["message"]["text"]


def test_query_schema_and_exact_source_validation(draft):
    from enrolment.errors import ApiError
    from enrolment.models import Plan

    body = {
        "action": "query",
        "query": {
            "topic": "friend_matches",
            "friends": ["Maya"],
            "source": "Which classes match Maya?",
        },
    }
    instance, _ = parser(json.dumps(body))
    assert (
        instance.parse(
            "Which classes match Maya?", context={}, plan=Plan.model_validate(draft)
        ).action
        == "query"
    )
    with pytest.raises(ApiError):
        instance.parse("hello", context={}, plan=Plan.model_validate(draft))
    with pytest.raises(ValidationError):
        Intent.model_validate(
            {**body, "rules": [{"kind": "dayoff", "value": 5, "source": "Friday"}]}
        )
    with pytest.raises(ValidationError):
        Intent.model_validate({"action": "query"})


def test_flattened_query_envelope_is_recovered_but_conflicts_and_mutations_are_rejected():
    from enrolment.errors import ApiError

    query = {"topic": "preferences", "source": "Why this score?"}
    for body in [{"action": "query", **query}, {"action": "query", "query": query, **query}]:
        instance, _ = parser(json.dumps(body))
        assert instance.parse("Why this score?", context={}).query.topic == "preferences"
    for body in [
        {"action": "query", "query": query, "topic": "schedule"},
        {"action": "query", **query, "rules": [{"kind": "dayoff", "value": 5, "source": "Why"}]},
    ]:
        instance, _ = parser(json.dumps(body))
        with pytest.raises(ApiError):
            instance.parse("Why this score?", context={})


def test_identity_question_before_and_after_build_returns_only_directory_identity(app, draft):
    from types import SimpleNamespace

    service = app.extensions["enrolment"]
    service.catalogue.students["student-a"] = service.catalogue.profile("student-a").model_copy(
        deep=True
    )
    service.directory = SimpleNamespace(
        lookup_student=lambda reference: {"name": "Maya Okafor", "student_id": "32000001"},
        resolve_student=lambda reference, owner: ("Maya Okafor", ["psyc-l02", "stat-l01"]),
    )
    service.parser.parse = lambda *args, **kwargs: Intent(
        action="query",
        query=TimetableQuery(
            topic="student_identity", friends=["32000001"], source="Who is student 32000001"
        ),
    )
    result = service.parse("student-a", "Who is student 32000001")
    assert result.rules == []
    assert result.message.text == "Student 32000001 is Maya Okafor."
    assert result.message.steps == []
    assert ask(app, draft, "student_identity", friends=["32000001"]).strip() == result.message.text
    assert "Enter a student name or student ID" in ask(app, draft, "student_identity")


def test_identity_query_without_directory_does_not_guess_from_demo_friends(app, draft):
    assert "lookup is unavailable" in ask(app, draft, "student_identity", friends=["32000001"])


def test_ai_accepts_identity_query_and_validates_its_source():
    from enrolment.errors import ApiError

    text = "Who is student 32000001"
    instance, _ = parser(
        json.dumps(
            {
                "action": "query",
                "query": {"topic": "student_identity", "friends": ["32000001"], "source": text},
            }
        )
    )
    result = instance.parse(text, context={"student_directory_lookup": True})
    assert result.query.topic == "student_identity" and result.query.friends == ["32000001"]
    with pytest.raises(ApiError):
        instance.parse("Who is someone else?", context={})
