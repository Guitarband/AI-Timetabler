import pytest
from pydantic import ValidationError

from enrolment.ai import canonical_rules
from enrolment.catalogue import Catalogue, Profile
from enrolment.models import ExtractedRule, Intent, Plan, Rule, SolveRequest
from enrolment.solver import solve
from tests.test_api import assert_plan

MAYA, LEO = "Maya Okafor", "Leo Chen"


def friend(name, index=0):
    return Rule(id=f"friend-{index}", kind="friend", value=name, label=f"Match {name}", source=name)


@pytest.mark.parametrize(
    "names,counts,seminar,workshop,percent",
    [
        ([MAYA], {MAYA: 3}, "phil-s01", "writ-w01", 100),
        ([LEO], {LEO: 3}, "phil-s02", "writ-w03", 100),
        ([MAYA, LEO], {MAYA: 2, LEO: 3}, "phil-s02", "writ-w03", 83),
        ([LEO, MAYA], {MAYA: 2, LEO: 3}, "phil-s02", "writ-w03", 83),
    ],
)
def test_individual_and_combined_matches(
    app, client, headers, names, counts, seminar, workshop, percent
):
    rules = [friend(name, i).model_dump() for i, name in enumerate(names)]
    response = client.post("/solve", json={"rules": rules}, headers=headers)
    assert response.status_code == 200
    plan = assert_plan(response.json, app)
    assert {f.name: f.shared for f in plan.friends} == counts
    assert all(f.total == 3 for f in plan.friends)
    assert plan.friend == plan.friends[0]  # existing client compatibility
    assert plan.match_pct == percent
    keys = {s.key for s in plan.sections}
    assert {seminar, workshop} <= keys
    shared = app.extensions["enrolment"].catalogue.profile("student-a").friends
    for section in plan.sections:
        expected = {name for name in names if section.key in shared[name]}
        assert set(section.shared_with) == expected
        assert section.with_friend == bool(expected)
    assert len(plan.sections) == 8  # a class shared with both is still one class


def test_duplicate_friend_aliases_rejected(client, headers):
    rules = [friend(MAYA).model_dump(), friend(" maya okafor ", 1).model_dump()]
    result = client.post("/solve", json={"rules": rules}, headers=headers)
    assert result.status_code == 422
    extracted = [ExtractedRule(kind="friend", value=r["value"], source="Maya") for r in rules]
    assert len(canonical_rules(extracted)) == 1


def test_unknown_friend_has_zero_matches_not_access_to_another_profile(app):
    service = app.extensions["enrolment"]
    service.catalogue.students["private-owner"] = Profile(
        approved_courses=["PHIL 1100"], friends={"Private Friend": ["phil-s01"]}
    )
    plan = service.build("student-a", [friend("Private Friend")])
    assert plan.friends[0].shared == plan.friends[0].total == 0
    assert plan.scores[0].status == "unmet"
    assert not any(s.with_friend or s.shared_with for s in plan.sections)


def test_other_courses_do_not_reduce_friend_match_percentage():
    catalogue = Catalogue.load("data/catalogue.json")
    profile = Profile(approved_courses=["PSYC 1010"], friends={MAYA: ["psyc-l02", "phil-s01"]})
    plan = solve(catalogue, profile, [friend(MAYA)])
    assert plan.match_pct == 100
    assert plan.friends[0].shared == plan.friends[0].total == 1
    assert profile.friends[MAYA] == ["psyc-l02", "phil-s01"]  # no mutation


def test_each_friend_has_equal_weight_despite_different_timetable_sizes():
    catalogue = Catalogue.load("data/catalogue.json")
    profile = catalogue.demo_profile.model_copy(
        update={
            "friends": {
                MAYA: ["phil-s01"],
                LEO: ["phil-s02", "writ-w03", "psyc-l02", "stat-l01"],
            }
        }
    )
    plan = solve(catalogue, profile, [friend(MAYA), friend(LEO, 1)])
    assert {f.name: (f.shared, f.total) for f in plan.friends} == {
        MAYA: (1, 1),
        LEO: (3, 4),
    }
    assert plan.match_pct == 88  # mean of 100% and 75%, not raw match count


def test_adding_second_friend_keeps_best_effort_and_undo_restores_first(app, client, headers):
    service = app.extensions["enrolment"]
    first = service.build("student-a", [friend(MAYA)])
    service.parser.parse = lambda *args, **kwargs: Intent(
        action="rules", rules=[ExtractedRule(kind="friend", value=LEO, source=LEO)]
    )
    response = client.post(
        "/adjust", headers=headers, json={"plan_id": first.plan_id, "text": f"Also match {LEO}"}
    )
    assert response.status_code == 200
    second = assert_plan(response.json, app)
    assert second.version == 2 and second.changed
    # A tie preserves Maya's seminar; moving the workshop improves Leo's match.
    assert {f.name: f.shared for f in second.friends} == {MAYA: 3, LEO: 2}
    assert second.match_pct == 83
    assert any(
        s.key == "writ-w03" and s.changed and s.shared_with == [LEO] for s in second.sections
    )
    # Repeating the same name with different casing must not inflate its weight.
    service.parser.parse = lambda *args, **kwargs: Intent(
        action="rules", rules=[ExtractedRule(kind="friend", value=" leo chen ", source="Leo")]
    )
    repeated = service.adjust("student-a", second.plan_id, "Also match Leo")
    assert not repeated.changed and repeated.plan_id == second.plan_id
    service.parser.parse = lambda *args, **kwargs: Intent(action="undo")
    restored = service.adjust("student-a", second.plan_id, "Undo")
    assert restored.version == 3
    assert [f.name for f in restored.friends] == [MAYA]
    assert {s.key for s in restored.sections} == {s.key for s in first.sections}
    assert all(LEO not in s.shared_with for s in restored.sections)


def test_friend_preferences_do_not_override_required_time_change(app):
    service = app.extensions["enrolment"]
    first = service.build("student-a", [friend(MAYA)])
    service.parser.parse = lambda *args, **kwargs: Intent(
        action="rules",
        rules=[
            ExtractedRule(kind="friend", value=LEO, source=LEO),
            ExtractedRule(kind="earliest", value=1200, source="after 8pm"),
        ],
    )
    result = service.adjust("student-a", first.plan_id, "Match Leo Chen, all classes after 8pm")
    assert not result.changed and result.plan_id == first.plan_id


def test_catalogue_rejects_ambiguous_shared_friend_names():
    catalogue = Catalogue.load("data/catalogue.json").model_dump()
    catalogue["demo_profile"]["friends"][" maya okafor "] = ["psyc-l02"]
    with pytest.raises(ValidationError, match="distinct"):
        Catalogue.model_validate(catalogue)
    assert len(SolveRequest(rules=[friend(MAYA), friend(LEO, 1)]).rules) == 2


def test_older_saved_plans_retain_friend_labels(app):
    plan = app.extensions["enrolment"].build("student-a", [friend(MAYA)])
    legacy = plan.model_dump(exclude={"friends"})
    for section in legacy["sections"]:
        section.pop("shared_with")
    restored = Plan.model_validate(legacy)
    assert restored.friends == plan.friends
    assert [s.shared_with for s in restored.sections] == [s.shared_with for s in plan.sections]
