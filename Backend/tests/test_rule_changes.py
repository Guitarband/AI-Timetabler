import pytest

from enrolment.models import Intent, Rule
from enrolment.rule_changes import conflicts
from tests.test_class_choices import post


def propose(app, client, headers, draft, *, kind="earliest", value=540, removals=None):
    intent = {"action": "rules", "rules": [{"kind": kind, "value": value, "source": "new rule"}]}
    if removals:
        intent["remove_rules"] = removals
    app.extensions["enrolment"].parser.parse = lambda *args, **kwargs: Intent.model_validate(intent)
    response = post(client, headers, "/adjust", draft, text="new rule")
    assert not response["changed"]
    assert response["rules"] == draft["rules"]
    assert response["sections"] == draft["sections"]
    return response["message"]["rule_change"]


def test_conflict_confirmation_applies_reviewed_rules_without_ai_reinterpretation(
    app, client, headers, draft
):
    proposal = propose(app, client, headers, draft)
    assert [r["kind"] for r in proposal["remove"]] == ["earliest"]
    assert proposal["add"][0]["value"] == 540
    assert "different limits" in proposal["reasons"][0]
    app.extensions["enrolment"].parser.parse = lambda *args, **kwargs: pytest.fail(
        "Must not reparse approval"
    )
    changed = post(client, headers, "/rule-change", draft, token=proposal["token"], accept=True)
    assert changed["changed"] and changed["version"] == draft["version"] + 1
    assert [r["value"] for r in changed["rules"] if r["kind"] == "earliest"] == [540]
    assert [r for r in changed["rules"] if r["kind"] != "earliest"] == [
        r for r in draft["rules"] if r["kind"] != "earliest"
    ]
    stored, _ = app.extensions["enrolment"].store.get("student-a", draft["plan_id"])
    assert stored.model_dump()["rules"] == draft["rules"]
    assert (
        client.post(
            "/rule-change",
            headers=headers,
            json={"plan_id": draft["plan_id"], "token": proposal["token"], "accept": True},
        ).status_code
        == 409
    )


def test_declining_proposal_preserves_editable_plan(app, client, headers, draft):
    proposal = propose(app, client, headers, draft)
    declined = post(client, headers, "/rule-change", draft, token=proposal["token"], accept=False)
    assert declined["rules"] == draft["rules"] and not declined["changed"]
    app.extensions["enrolment"].store.get("student-a", draft["plan_id"], editable=True)


def test_explicit_removal_applies_immediately(app, client, headers, draft):
    old = next(r for r in draft["rules"] if r["kind"] == "dayoff")
    app.extensions["enrolment"].parser.parse = lambda text, **kwargs: Intent.model_validate(
        {
            "action": "rules",
            "remove_rules": [{"rule_id": old["id"], "source": text, "mode": "explicit"}],
        }
    )
    result = post(client, headers, "/adjust", draft, text="Remove my Friday-off rule")
    assert result["changed"] and "rule_change" not in result["message"]
    assert result["rules"] == [r for r in draft["rules"] if r["id"] != old["id"]]


def test_unspecified_removal_mode_requires_review(app, client, headers, draft):
    old = next(r for r in draft["rules"] if r["kind"] == "earliest")
    proposal = propose(
        app, client, headers, draft, removals=[{"rule_id": old["id"], "source": "new rule"}]
    )
    assert proposal["remove"] == [old]


def test_token_cannot_be_tampered_transferred_or_used_after_expiry(
    app, client, headers, draft, monkeypatch
):
    proposal = propose(app, client, headers, draft)
    payload = {"plan_id": draft["plan_id"], "token": proposal["token"], "accept": True}
    assert (
        client.post(
            "/rule-change", headers=headers, json={**payload, "token": "x" + proposal["token"]}
        ).status_code
        == 409
    )
    assert (
        client.post(
            "/rule-change", headers={**headers, "X-User-Id": "student-b"}, json=payload
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/rule-change", headers=headers, json={**payload, "plan_id": "another-plan"}
        ).status_code
        == 404
    )
    import time

    now = time.time()
    monkeypatch.setattr("itsdangerous.timed.time.time", lambda: now + 3601)
    assert client.post("/rule-change", headers=headers, json=payload).status_code == 409


def test_approval_cannot_change_confirmed_plan(app, client, headers, draft):
    proposal = propose(app, client, headers, draft)
    post(client, headers, "/confirm", draft)
    response = client.post(
        "/rule-change",
        headers=headers,
        json={"plan_id": draft["plan_id"], "token": proposal["token"], "accept": True},
    )
    assert response.status_code == 409


def test_impossible_replacement_does_not_delete_rules(app, client, headers, draft):
    proposal = propose(app, client, headers, draft, kind="latest", value=540)
    assert "start limit" in proposal["reasons"][0]
    result = post(client, headers, "/rule-change", draft, token=proposal["token"], accept=True)
    assert not result["changed"] and result["rules"] == draft["rules"]


def test_relative_change_prompts_for_dayoff_removal_and_respects_kept_classes(
    app, client, headers, draft
):
    pinned = post(client, headers, "/keep", draft, section_key="phil-s02", keep=True)
    app.extensions["enrolment"].parser.parse = lambda text, **kwargs: Intent.model_validate(
        {
            "action": "alternatives",
            "changes": [{"from_key": "phil-s02", "direction": "other_day", "source": text}],
        }
    )
    proposal = post(client, headers, "/adjust", pinned, text="Move my seminar to another day")[
        "message"
    ]["rule_change"]
    assert {r["kind"] for r in proposal["remove"]} == {"earliest", "dayoff"}
    result = post(client, headers, "/rule-change", pinned, token=proposal["token"], accept=True)
    assert not result["changed"] and result["kept_sections"] == ["phil-s02"]
    assert result["rules"] == pinned["rules"]


@pytest.mark.parametrize(
    "old_kind,old_value,new_kind,new_value,expected",
    [
        ("earliest_day", "1@600", "latest_day", "2@540", False),
        ("earliest_day", "1@600", "latest_day", "1@540", True),
        ("earliest", 600, "latest", 1080, False),
        ("dayoff", 1, "dayoff", 5, False),
        ("friend", "Maya", "friend", "Leo", False),
        ("earliest", 600, "earliest", 600, False),
    ],
)
def test_only_overlapping_conflicts_are_proposed(
    old_kind, old_value, new_kind, new_value, expected
):
    old = Rule(id="old", kind=old_kind, value=old_value, label="old", source="old")
    new = Rule(id="new", kind=new_kind, value=new_value, label="new", source="new")
    assert bool(conflicts([old], [new], {}, None)) == expected


@pytest.mark.parametrize("close_alternative", [False, True])
def test_relative_approval_rechecks_capacity_and_undo_restores_removed_rules(
    app, client, headers, draft, close_alternative
):
    service = app.extensions["enrolment"]
    service.parser.parse = lambda text, **kwargs: Intent.model_validate(
        {
            "action": "alternatives",
            "changes": [{"from_key": "phil-s02", "direction": "other_day", "source": text}],
        }
    )
    proposal = post(client, headers, "/adjust", draft, text="Move my seminar to another day")[
        "message"
    ]["rule_change"]
    if close_alternative:
        target = next(s for s in service.catalogue.sections if s.key == "phil-s01")
        target.selectable = False
        target.remaining_seats = 0
    result = post(client, headers, "/rule-change", draft, token=proposal["token"], accept=True)
    if close_alternative:
        assert not result["changed"] and result["rules"] == draft["rules"]
        assert result["sections"] == draft["sections"]
    else:
        assert result["changed"] and "phil-s01" in {s["key"] for s in result["sections"]}
        assert {r["kind"] for r in result["rules"]} == {"friend", "section_other_day"}
        service.parser.parse = lambda *args, **kwargs: Intent(action="undo")
        restored = post(client, headers, "/adjust", result, text="undo")
        assert restored["rules"] == draft["rules"]
        assert {s["key"] for s in restored["sections"]} == {s["key"] for s in draft["sections"]}
