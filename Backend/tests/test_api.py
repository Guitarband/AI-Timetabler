import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import pytest

from enrolment import create_app
from enrolment.models import Confirmation, Context, ParseResponse, Plan
from enrolment.solver import overlaps
from tests.conftest import CHANGE, PREFERENCES


def assert_plan(body, app):
    plan = Plan.model_validate(body)
    catalogue = app.extensions["enrolment"].catalogue
    published = {s.key: s for s in catalogue.sections}
    assert plan.summary.sections == len(plan.sections) == 8
    assert len({s.key for s in plan.sections}) == len(plan.sections)
    assert len({published[s.key].group for s in plan.sections}) == 8
    assert {s.rule_id for s in plan.scores} == {r.id for r in plan.rules}
    assert len(plan.scores) == len(plan.rules)
    assert 0 <= plan.match_pct <= 100
    for i, section in enumerate(plan.sections):
        assert section.model_dump(exclude={"changed", "with_friend", "shared_with"}) == published[
            section.key
        ].model_dump(
            exclude={
                "changed",
                "with_friend",
                "shared_with",
                "group",
                "selectable",
                "remaining_seats",
            }
        )
        assert not any(overlaps(section, other) for other in plan.sections[i + 1 :])
    assert plan.summary.credits == sum(
        max(s.credits for s in plan.sections if s.code == code)
        for code in {s.code for s in plan.sections}
    )
    return plan


def test_complete_journey_and_persistence(app, client, headers, settings):
    context = Context.model_validate(client.get("/context", headers=headers).json)
    assert context.student_name == "Priya Shah"
    assert context.published_sections == 10
    assert context.approved_courses == 5
    parsed = ParseResponse.model_validate(
        client.post("/parse", json={"text": PREFERENCES}, headers=headers).json
    )
    assert {r.kind: r.value for r in parsed.rules} == {
        "earliest": 600,
        "dayoff": 5,
        "friend": "Maya Okafor",
    }
    assert all(r.source in PREFERENCES for r in parsed.rules)
    rules = [r.model_dump() for r in parsed.rules]
    first = assert_plan(client.post("/solve", json={"rules": rules}, headers=headers).json, app)
    assert first.version == 1 and first.changed
    assert first.rules == parsed.rules
    assert first.friend.shared == 2 and first.friend.total == 3
    adjusted = client.post(
        "/adjust", json={"plan_id": first.plan_id, "text": CHANGE}, headers=headers
    )
    assert adjusted.status_code == 200
    second = assert_plan(adjusted.json, app)
    assert second.version == 2 and second.plan_id != first.plan_id and second.changed
    assert any(s.key == "writ-w03" and s.changed for s in second.sections)
    assert all(
        any(old.key == s.key for old in first.sections) for s in second.sections if not s.changed
    )
    impossible = client.post(
        "/adjust",
        json={"plan_id": second.plan_id, "text": "Move all my classes to Saturday."},
        headers=headers,
    ).json
    assert impossible["changed"] is False
    assert impossible["plan_id"] == second.plan_id
    assert impossible["version"] == second.version
    assert impossible["sections"] == adjusted.json["sections"]
    confirmation = client.post("/confirm", json={"plan_id": second.plan_id}, headers=headers)
    assert confirmation.status_code == 200
    result = Confirmation.model_validate(confirmation.json)
    assert result.sections == len(second.sections) and result.courses == 5 and result.credits == 15
    assert datetime.fromisoformat(result.confirmed_at)
    restarted = create_app(settings).test_client()
    assert (
        restarted.post("/confirm", json={"plan_id": second.plan_id}, headers=headers).json
        == confirmation.json
    )


def test_unknown_text_does_not_invent_rules(client, headers):
    result = client.post(
        "/parse", json={"text": "purple elephants sing on tuesdays"}, headers=headers
    )
    assert result.status_code == 200 and result.json["rules"] == []
    assert "couldn't" in result.json["message"]["text"]


def test_confirm_v1_and_concurrent_retries(app, headers, draft):
    def confirm(_):
        with app.test_client() as client:
            result = client.post("/confirm", json={"plan_id": draft["plan_id"]}, headers=headers)
            assert result.status_code == 200
            return result.json

    with ThreadPoolExecutor(max_workers=6) as executor:
        results = list(executor.map(confirm, range(12)))
    assert all(result == results[0] for result in results)


def test_authentication_and_cors(client, headers):
    assert client.get("/health").json == {"status": "ok"}
    for route in ["/context", "/parse", "/solve", "/adjust", "/confirm"]:
        response = client.open(route, method="GET" if route == "/context" else "POST", json={})
        assert response.status_code == 401 and response.json["detail"]
    assert client.get("/context", headers={"X-User-Id": "attacker"}).status_code == 401
    assert (
        client.get("/context", headers={"Authorization": headers["Authorization"]}).status_code
        == 400
    )
    preflight = client.options(
        "/parse",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Authorization,X-User-Id,Content-Type",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"
    assert "Authorization" in preflight.headers["Access-Control-Allow-Headers"]
    bad = client.options(
        "/parse",
        headers={"Origin": "https://attacker.example", "Access-Control-Request-Method": "POST"},
    )
    assert "Access-Control-Allow-Origin" not in bad.headers
    assert "Access-Control-Allow-Credentials" not in preflight.headers
    assert client.get("/context", headers=headers).headers["Cache-Control"] == "private, no-store"


def test_cross_user_unknown_stale_and_confirmed_plans(client, headers, draft):
    other = {**headers, "X-User-Id": "student-b"}
    for identity, plan_id in [(other, draft["plan_id"]), (headers, "missing")]:
        assert (
            client.post(
                "/adjust", headers=identity, json={"plan_id": plan_id, "text": CHANGE}
            ).status_code
            == 404
        )
        assert (
            client.post("/confirm", headers=identity, json={"plan_id": plan_id}).status_code == 404
        )
    new = client.post(
        "/adjust", headers=headers, json={"plan_id": draft["plan_id"], "text": CHANGE}
    ).json
    assert (
        client.post("/confirm", headers=headers, json={"plan_id": draft["plan_id"]}).status_code
        == 409
    )
    assert (
        client.post(
            "/adjust", headers=headers, json={"plan_id": draft["plan_id"], "text": CHANGE}
        ).status_code
        == 409
    )
    assert (
        client.post("/confirm", headers=headers, json={"plan_id": new["plan_id"]}).status_code
        == 200
    )
    assert (
        client.post(
            "/adjust", headers=headers, json={"plan_id": new["plan_id"], "text": "undo"}
        ).status_code
        == 409
    )


def test_undo_and_explicit_tradeoff(app, client, headers, draft):
    changed = client.post(
        "/adjust", headers=headers, json={"plan_id": draft["plan_id"], "text": CHANGE}
    ).json
    undo = client.post(
        "/adjust", headers=headers, json={"plan_id": changed["plan_id"], "text": "undo"}
    ).json
    assert undo["version"] == 3
    assert {s["key"] for s in undo["sections"]} == {s["key"] for s in draft["sections"]}
    tradeoff = client.post(
        "/adjust",
        headers=headers,
        json={"plan_id": undo["plan_id"], "text": "Put me in Maya's seminar."},
    ).json
    assert_plan(tradeoff, app)
    assert tradeoff["friend"]["shared"] == 3
    assert tradeoff["match_pct"] < undo["match_pct"]
    assert "Not fully met" in tradeoff["message"]["note"]


@pytest.mark.parametrize(
    "body",
    [
        None,
        [],
        {"text": ""},
        {"text": "   "},
        {"text": 3},
        {"text": "x", "userId": "other"},
        {"text": "x" * 10001},
    ],
)
def test_invalid_parse_payloads(client, headers, body):
    result = client.post(
        "/parse", headers={**headers, "Content-Type": "application/json"}, data=json.dumps(body)
    )
    assert result.status_code == 422 and result.json["detail"]


def test_json_errors_and_limits(client, headers):
    assert client.post("/parse", data="text=hello", headers=headers).status_code == 415
    assert (
        client.post(
            "/parse", data="{", headers={**headers, "Content-Type": "application/json"}
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/parse", data="x" * 140000, headers={**headers, "Content-Type": "application/json"}
        ).status_code
        == 413
    )
    assert client.get("/missing", headers=headers).json["detail"]
    assert client.get("/parse", headers=headers).status_code == 405


def test_unknown_rule_preserved_and_scored(app, client, headers):
    rule = {
        "id": "local-custom-123",
        "kind": "unimplemented",
        "value": "abc",
        "label": "Custom request",
        "source": "added by you",
    }
    response = client.post("/solve", headers=headers, json={"rules": [rule]})
    plan = assert_plan(response.json, app)
    assert plan.rules[0].model_dump() == rule
    assert plan.scores[0].status == "unmet" and "cannot evaluate" in plan.scores[0].note


@pytest.mark.parametrize(
    "kind,value",
    [
        ("earliest", True),
        ("earliest", "600"),
        ("earliest", -1),
        ("latest", 1440),
        ("dayoff", 6),
        ("nolabs", 0),
        ("lunch", 0),
        ("friend", ""),
        ("latest_day", "6@900"),
    ],
)
def test_rule_validation(client, headers, kind, value):
    rule = {"id": "r", "kind": kind, "value": value, "label": "Rule", "source": "text"}
    assert client.post("/solve", headers=headers, json={"rules": [rule]}).status_code == 422


def test_duplicate_ids_rejected(client, headers):
    rule = {
        "id": "same",
        "kind": "dayoff",
        "value": 5,
        "label": "Friday free",
        "source": "added by you",
    }
    assert client.post("/solve", headers=headers, json={"rules": [rule, rule]}).status_code == 422


def test_no_clash_free_solution_and_solver_limits(app, client, headers):
    service = app.extensions["enrolment"]
    # Move the only STAT lecture into the only PSYC lecture slot.
    stat = next(s for s in service.catalogue.sections if s.key == "stat-l01")
    stat.day, stat.start, stat.end = 1, "10:00", "11:30"
    result = client.post("/solve", headers=headers, json={"rules": []})
    assert result.status_code == 422 and "clash-free" in result.json["detail"]
    service.settings["MAX_SOLVER_NODES"] = 1
    assert client.post("/solve", headers=headers, json={"rules": []}).status_code == 503


def test_non_demo_requires_per_user_profile(app, client, headers):
    app.extensions["enrolment"].catalogue.demo = False
    assert client.get("/context", headers=headers).status_code == 404


def test_malformed_session_name_is_a_client_error(client, headers):
    result = client.get("/context", headers={**headers, "X-User-Name": "%FF"})
    assert result.status_code == 400


def test_concurrent_adjustments_cannot_fork_the_current_version(app, headers, draft):
    import threading

    service = app.extensions["enrolment"]
    original = service.parser
    barrier = threading.Barrier(2)

    class SimultaneousParser:
        def parse(self, text, **kwargs):
            barrier.wait(timeout=5)
            return original.parse(text, **kwargs)

    service.parser = SimultaneousParser()

    def adjust(_):
        with app.test_client() as client:
            return client.post(
                "/adjust", headers=headers, json={"plan_id": draft["plan_id"], "text": CHANGE}
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(adjust, range(2)))
    assert sorted(results) == [200, 409]


def test_infeasible_new_constraint_keeps_the_current_plan(app, client, headers, draft):
    from enrolment.models import Intent

    class ImpossibleParser:
        def parse(self, text, **kwargs):
            return Intent.model_validate(
                {"action": "rules", "rules": [{"kind": "earliest", "value": 1380, "source": text}]}
            )

    app.extensions["enrolment"].parser = ImpossibleParser()
    result = client.post(
        "/adjust", headers=headers, json={"plan_id": draft["plan_id"], "text": "Start after 23:00"}
    )
    assert result.status_code == 200
    assert result.json["changed"] is False
    assert result.json["plan_id"] == draft["plan_id"]
    assert result.json["rules"] == draft["rules"]
    assert result.json["sections"] == draft["sections"]


def test_ai_cannot_move_to_another_class_group(app, client, headers, draft):
    from enrolment.models import Intent

    class InvalidParser:
        def parse(self, text, **kwargs):
            return Intent.model_validate(
                {"action": "move", "move": {"from_key": "writ-w01", "to_key": "psyc-l02"}}
            )

    app.extensions["enrolment"].parser = InvalidParser()
    result = client.post(
        "/adjust", headers=headers, json={"plan_id": draft["plan_id"], "text": "Move workshop"}
    )
    assert result.status_code == 502


def test_replacing_one_rule_preserves_unrelated_rules_and_undo(app, client, headers, draft):
    from enrolment.models import Intent

    original_parser = app.extensions["enrolment"].parser
    old_rule = next(r for r in draft["rules"] if r["kind"] == "earliest")
    text = "Replace the start limit with 09:00"

    class ReplacementParser:
        def parse(self, text, **kwargs):
            return Intent.model_validate(
                {
                    "action": "rules",
                    "rules": [{"kind": "earliest", "value": 540, "source": text}],
                    "remove_rules": [{"rule_id": old_rule["id"], "source": text}],
                }
            )

    app.extensions["enrolment"].parser = ReplacementParser()
    response = client.post(
        "/adjust", headers=headers, json={"plan_id": draft["plan_id"], "text": text}
    )
    assert response.status_code == 200
    new = response.json
    assert new["version"] == 2
    assert [r["value"] for r in new["rules"] if r["kind"] == "earliest"] == [540]
    assert [r for r in new["rules"] if r["kind"] != "earliest"] == [
        r for r in draft["rules"] if r["kind"] != "earliest"
    ]
    assert "Removed:" in new["message"]["note"]
    app.extensions["enrolment"].parser = original_parser
    undo = client.post(
        "/adjust", headers=headers, json={"plan_id": new["plan_id"], "text": "undo"}
    ).json
    assert undo["rules"] == draft["rules"]


def test_unknown_rule_removal_cannot_change_a_plan(app, client, headers, draft):
    from enrolment.models import Intent

    class InvalidRemoval:
        def parse(self, text, **kwargs):
            return Intent.model_validate(
                {"action": "rules", "remove_rules": [{"rule_id": "unknown", "source": text}]}
            )

    app.extensions["enrolment"].parser = InvalidRemoval()
    response = client.post(
        "/adjust", headers=headers, json={"plan_id": draft["plan_id"], "text": "Remove a rule"}
    )
    assert response.status_code == 502
