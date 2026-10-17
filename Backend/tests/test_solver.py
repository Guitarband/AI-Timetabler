import pytest

from enrolment.catalogue import Profile
from enrolment.models import Rule, Section
from enrolment.solver import score


def section(key, start, end, *, kind="Lecture", day=1):
    return Section(
        key=key,
        code=key,
        title=key,
        kind=kind,
        section="01",
        day=day,
        start=start,
        end=end,
        room="Room",
        credits=3,
    )


@pytest.mark.parametrize(
    "kind,value,expected",
    [
        ("earliest", 720, 0.5),
        ("latest", 780, 0.5),
        ("dayoff", 5, 1),
        ("lunch", 60, 1),
        ("lunch", 61, 0),
        ("nolabs", 1, 1),
        ("friend", "Unshared Friend", 0),
        ("latest_day", "1@780", 0.5),
    ],
)
def test_scores_reflect_the_actual_classes(kind, value, expected):
    sections = [section("a", "11:00", "12:00"), section("b", "13:00", "14:00")]
    rule = Rule(id="r", kind=kind, value=value, label="Rule", source="text")
    fraction, note = score(rule, sections, Profile(approved_courses=["a", "b"]))
    assert fraction == expected and note


def test_touching_labs_are_adjacent_but_labs_on_different_days_are_not():
    rule = Rule(id="r", kind="nolabs", value=1, label="Labs", source="text")
    classes = [
        section("a", "11:00", "12:00", kind="Lab"),
        section("b", "12:00", "13:00", kind="Lab"),
    ]
    profile = Profile(approved_courses=["a", "b"])
    assert score(rule, classes, profile)[0] == 0
    classes[1].day = 2
    assert score(rule, classes, profile)[0] == 1


def test_earliest_day_ignores_earlier_classes_on_other_days():
    rule = Rule(
        id="r", kind="earliest_day", value="4@660", label="Thursday after 11", source="text"
    )
    classes = [section("a", "09:00", "10:00", day=1), section("b", "11:00", "12:00", day=4)]
    profile = Profile(approved_courses=["a", "b"])
    assert score(rule, classes, profile)[0] == 1
    classes[1].start = "10:30"
    assert score(rule, classes, profile)[0] == 0
