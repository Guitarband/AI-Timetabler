import json

import pytest
from pydantic import ValidationError

from enrolment.models import Intent, Rule, SectionChange
from tests.test_ai import parser
from tests.test_api import assert_plan


@pytest.fixture
def friday_plan(app):
    return app.extensions["enrolment"].build(
        "student-a",
        [Rule(id="maya", kind="friend", value="Maya Okafor", label="Match Maya", source="Maya")],
    )


def interpret(app, key="phil-s01", direction="later", same_day=False, **extra):
    intent = Intent(
        action="alternatives",
        changes=[
            SectionChange(from_key=key, direction=direction, same_day=same_day, source="request")
        ],
        **extra,
    )
    app.extensions["enrolment"].parser.parse = lambda *args, **kwargs: intent


@pytest.mark.parametrize("direction", ["later", "other_day", "different"])
def test_friday_alternative_preserves_required_class_and_reports_tradeoff(
    app, friday_plan, direction
):
    interpret(app, direction=direction)
    service = app.extensions["enrolment"]
    plan = service.adjust("student-a", friday_plan.plan_id, "request")
    assert_plan(plan.model_dump(), app)
    assert plan.changed and plan.version == 2
    assert "phil-s02" in {s.key for s in plan.sections}
    assert "phil-s01" not in {s.key for s in plan.sections}
    assert "Friday 09:00" in plan.message.text and "Thursday 13:00" in plan.message.text
    assert "All 8 required classes" in plan.message.text
    assert plan.friend.shared == 2 and plan.friend.total == 3
    assert plan.rules[0] == friday_plan.rules[0]
    assert plan.scores[-1].status == "met"
    assert plan.rules[-1].kind == f"section_{direction}"
    # The preference survives storage and later requests; undo removes it.
    stored, _ = service.store.get("student-a", plan.plan_id)
    assert stored.rules == plan.rules
    service.parser.parse = lambda *args, **kwargs: Intent(action="undo")
    undone = service.adjust("student-a", plan.plan_id, "undo")
    assert undone.rules == friday_plan.rules
    assert {s.key for s in undone.sections} == {s.key for s in friday_plan.sections}


def test_same_day_is_never_silently_relaxed(app, friday_plan):
    interpret(app, same_day=True)
    result = app.extensions["enrolment"].adjust("student-a", friday_plan.plan_id, "request")
    assert not result.changed and result.plan_id == friday_plan.plan_id
    assert "on Friday" in result.message.text
    assert "Published alternative" in result.message.text and "Thursday" in result.message.text
    assert result.rules == friday_plan.rules and result.sections == friday_plan.sections


def test_missing_alternatives_explains_a_required_class_cannot_be_removed(app, friday_plan):
    interpret(app, key="psyc-l02", direction="other_day")
    result = app.extensions["enrolment"].adjust("student-a", friday_plan.plan_id, "request")
    assert not result.changed
    assert "no other published section" in result.message.text
    assert result.sections == friday_plan.sections


def test_solver_searches_other_alternatives_if_one_clashes(app, friday_plan):
    service = app.extensions["enrolment"]
    existing = next(s for s in service.catalogue.sections if s.key == "phil-s02")
    # This option starts later than Friday but clashes with the Thursday lecture.
    clash = existing.model_copy(update={"key": "phil-clash", "start": "11:00", "end": "12:30"})
    service.catalogue.sections.insert(0, clash)
    interpret(app)
    plan = service.adjust("student-a", friday_plan.plan_id, "request")
    assert_plan(plan.model_dump(), app)
    assert "phil-s02" in {s.key for s in plan.sections}
    assert "phil-clash" not in {s.key for s in plan.sections}


def test_new_deadline_is_enforced_alongside_relative_workshop_request(app, friday_plan):
    from enrolment.models import ExtractedRule

    interpret(
        app,
        key="writ-w01",
        direction="earlier",
        rules=[ExtractedRule(kind="latest_day", value="3@900", source="request")],
    )
    plan = app.extensions["enrolment"].adjust("student-a", friday_plan.plan_id, "request")
    assert any(s.key == "writ-w03" and s.changed for s in plan.sections)
    assert all(s.end <= "15:00" for s in plan.sections if s.day == 3)
    assert all(s.status == "met" for s in plan.scores)
    # The user's Friday request also works after the successful workshop change.
    interpret(app, key="phil-s01", direction="later")
    next_plan = app.extensions["enrolment"].adjust("student-a", plan.plan_id, "request")
    assert next_plan.version == 3
    assert {"writ-w03", "phil-s02"} <= {s.key for s in next_plan.sections}
    assert next_plan.rules[: len(plan.rules)] == plan.rules
    assert all(s.end <= "15:00" for s in next_plan.sections if s.day == 3)


def test_invalid_or_unselected_reference_cannot_mutate_plan(app, client, headers, friday_plan):
    for key in ["invented", "phil-s02"]:
        interpret(app, key=key)
        result = client.post(
            "/adjust", headers=headers, json={"plan_id": friday_plan.plan_id, "text": "request"}
        )
        assert result.status_code == 502
    saved, _ = app.extensions["enrolment"].store.get(
        "student-a", friday_plan.plan_id, editable=True
    )
    assert saved == friday_plan


@pytest.mark.parametrize(
    "reason,phrase",
    [
        ("ambiguous", "Which class"),
        ("course_removal", "cannot drop a course"),
        ("outside_catalogue", "Monday–Friday"),
    ],
)
def test_unsupported_requests_get_actionable_explanations(app, friday_plan, reason, phrase):
    service = app.extensions["enrolment"]
    service.parser.parse = lambda *args, **kwargs: Intent(action="unsupported", reason=reason)
    result = service.adjust("student-a", friday_plan.plan_id, "request")
    assert not result.changed and result.plan_id == friday_plan.plan_id
    assert phrase in result.message.text


def test_relative_sources_are_grounded_and_require_an_existing_plan(friday_plan):
    body = {
        "action": "alternatives",
        "changes": [
            {"from_key": "phil-s01", "direction": "later", "source": "Friday is too early"}
        ],
    }
    instance, _ = parser(json.dumps(body))
    assert (
        instance.parse("Friday is too early", context={}, plan=friday_plan).changes[0].direction
        == "later"
    )
    from enrolment.errors import ApiError

    with pytest.raises(ApiError):
        instance.parse("Move my workshop", context={}, plan=friday_plan)
    with pytest.raises(ApiError):
        instance.parse("Friday is too early", context={})


def test_unused_rejection_reason_cannot_break_a_valid_adjustment(friday_plan):
    instance, _ = parser(
        json.dumps(
            {
                "action": "alternatives",
                "reason": "later",
                "changes": [{"from_key": "phil-s01", "direction": "later", "source": "too early"}],
            }
        )
    )
    result = instance.parse("too early", context={}, plan=friday_plan)
    assert result.action == "alternatives" and result.changes[0].direction == "later"


@pytest.mark.parametrize(
    "body",
    [
        {"action": "alternatives"},
        {"action": "rules", "changes": [{"from_key": "a", "direction": "later", "source": "a"}]},
        {
            "action": "alternatives",
            "changes": [
                {"from_key": "a", "direction": "other_day", "same_day": True, "source": "a"}
            ],
        },
        {
            "action": "alternatives",
            "changes": [{"from_key": "a", "direction": "later", "source": "a"}] * 2,
        },
    ],
)
def test_incoherent_relative_actions_rejected(body):
    with pytest.raises(ValidationError):
        Intent.model_validate(body)
