import json

from enrolment.models import Intent
from tests.test_ai import parser
from tests.test_api import assert_plan

REQUEST = "Fill in my timetable to allocate all my units with no clashes"


def test_plain_allocation_request_builds_without_optional_preferences(app, client, headers):
    parsed = client.post("/parse", headers=headers, json={"text": REQUEST})
    assert parsed.status_code == 200
    assert parsed.json["ready_to_build"] and parsed.json["rules"] == []
    built = client.post("/solve", headers=headers, json={"rules": []})
    assert built.status_code == 200
    assert_plan(built.json, app)
    assert built.json["match_pct"] == 100
    assert len(built.json["sections"]) == 8
    existing = client.post(
        "/adjust", headers=headers, json={"plan_id": built.json["plan_id"], "text": REQUEST}
    )
    assert existing.status_code == 200 and not existing.json["changed"]
    assert "all 8 required classes without clashes" in existing.json["message"]["text"]


def test_production_parser_accepts_build_intent_and_keeps_optional_preferences():
    instance, _ = parser(json.dumps({"action": "build", "rules": []}))
    assert instance.parse(REQUEST, context={}).action == "build"
    instance, _ = parser(
        json.dumps(
            {"action": "build", "rules": [{"kind": "dayoff", "value": 5, "source": "Fridays free"}]}
        )
    )
    result = instance.parse("Build my timetable with Fridays free", context={})
    assert result.action == "build" and result.rules[0].value == 5


def test_unknown_text_and_read_only_questions_do_not_offer_build(app, client, headers):
    parsed = client.post("/parse", headers=headers, json={"text": "purple clouds"})
    assert not parsed.json["ready_to_build"]
    app.extensions["enrolment"].parser.parse = lambda *a, **kw: Intent.model_validate(
        {"action": "query", "query": {"topic": "help", "source": "help"}}
    )
    parsed = client.post("/parse", headers=headers, json={"text": "help"})
    assert not parsed.json["ready_to_build"]
