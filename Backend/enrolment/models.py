import re
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, model_validator

NonEmpty = Annotated[str, Field(min_length=1, max_length=1000)]
Value = StrictInt | Annotated[StrictStr, Field(max_length=200)]
Weekday = Literal[1, 2, 3, 4, 5]
RELATIVE_KINDS = {
    "section_earlier",
    "section_later",
    "section_other_day",
    "section_different",
    "section_earlier_same_day",
    "section_later_same_day",
    "section_different_same_day",
}


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


def validate_value(kind: str, value: int | str) -> None:
    ranges = {
        "earliest": (0, 1439),
        "latest": (0, 1439),
        "dayoff": (1, 5),
        "nolabs": (1, 1),
        "lunch": (1, 180),
    }
    if kind in ranges:
        low, high = ranges[kind]
        if type(value) is not int or not low <= value <= high:
            raise ValueError(f"{kind} must be an integer between {low} and {high}.")
    if kind == "friend" and (not isinstance(value, str) or not value.strip()):
        raise ValueError("Enter a friend's name.")
    if kind in RELATIVE_KINDS and (not isinstance(value, str) or not value.strip()):
        raise ValueError("A relative section preference needs a published reference key.")
    if kind in {"latest_day", "earliest_day"}:
        if not isinstance(value, str) or not re.fullmatch(r"[1-5]@\d{1,4}", value):
            raise ValueError(f"{kind} must use day@minutes, for example 3@900.")
        if int(value.split("@")[1]) > 1439:
            raise ValueError(f"{kind} minutes must be below 1440.")


class Rule(Model):
    id: Annotated[str, Field(min_length=1, max_length=200)]
    kind: Annotated[str, Field(min_length=1, max_length=100)]
    value: Value
    label: NonEmpty
    source: Annotated[str, Field(max_length=10000)]

    @model_validator(mode="after")
    def valid(self) -> Self:
        if not self.id.strip() or not self.label.strip():
            raise ValueError("Rule IDs and labels cannot be blank.")
        validate_value(self.kind, self.value)
        return self


class RuleChangeProposal(Model):
    plan_id: str
    token: str
    remove: list[Rule]
    add: list[Rule]
    reasons: list[str]


class Message(Model):
    steps: list[str] = Field(default_factory=list)
    text: NonEmpty
    note: str | None = None
    rule_change: RuleChangeProposal | None = None


class Section(Model):
    key: NonEmpty
    code: NonEmpty
    title: NonEmpty
    kind: NonEmpty
    section: NonEmpty
    day: Weekday
    start: Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]
    end: Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]
    room: NonEmpty
    credits: Annotated[int, Field(ge=0)]
    with_friend: bool = False
    shared_with: list[str] = Field(default_factory=list)
    changed: bool = False

    @model_validator(mode="after")
    def ordered(self) -> Self:
        if self.end <= self.start:
            raise ValueError("Section end must be after start.")
        return self


class PublishedSection(Section):
    group: NonEmpty
    selectable: bool = True
    remaining_seats: Annotated[int, Field(ge=0)] | None = None


class RuleScore(Model):
    rule_id: str
    label: str
    status: Literal["met", "partial", "unmet"]
    note: str


class FriendMatch(Model):
    name: str
    shared: Annotated[int, Field(ge=0)]
    total: Annotated[int, Field(ge=0)]
    text: str


class PlanSummary(Model):
    sections: Annotated[int, Field(ge=0)]
    credits: Annotated[int, Field(ge=0)]
    hold_minutes: Annotated[int, Field(ge=0)]


class Plan(Model):
    plan_id: str
    version: Annotated[int, Field(ge=1)]
    changed: bool
    rules: list[Rule]
    sections: list[Section]
    kept_sections: list[str] = Field(default_factory=list)
    match_pct: Annotated[int, Field(ge=0, le=100)]
    scores: list[RuleScore]
    friend: FriendMatch | None = None
    friends: list[FriendMatch] = Field(default_factory=list)
    summary: PlanSummary
    message: Message
    source_sections: int | None = None

    @model_validator(mode="after")
    def legacy_friend_metadata(self) -> Self:
        # Upgrade older saved JSON in memory; historical plan rows stay immutable.
        if not self.friends and self.friend:
            self.friends = [self.friend]
        for section in self.sections:
            if (
                "shared_with" not in section.model_fields_set
                and section.with_friend
                and self.friend
            ):
                section.shared_with = [self.friend.name]
        return self


class Context(Model):
    student_name: str
    term: str
    approved_courses: int
    published_sections: int
    friends: list[str]
    greeting: Message


class Confirmation(Model):
    reference: str
    confirmed_at: str
    courses: int
    sections: int
    credits: int
    swap_deadline: str
    message: Message


class ConversationMessage(Model):
    role: Literal["user", "assistant"]
    content: Annotated[str, Field(min_length=1, max_length=4000)]


class ParseRequest(Model):
    text: Annotated[str, Field(min_length=1, max_length=10000)]
    history: Annotated[list[ConversationMessage], Field(max_length=12)] = Field(
        default_factory=list
    )

    @model_validator(mode="after")
    def nonblank(self) -> Self:
        if not self.text.strip():
            raise ValueError("Enter some timetable preferences.")
        if sum(len(message.content) for message in self.history) > 24000:
            raise ValueError("Conversation context is too long.")
        return self


class ParseResponse(Model):
    rules: list[Rule]
    message: Message
    ready_to_build: bool = False


class SolveRequest(Model):
    rules: Annotated[list[Rule], Field(max_length=100)]

    @model_validator(mode="after")
    def unique(self) -> Self:
        if len({r.id for r in self.rules}) != len(self.rules):
            raise ValueError("Rule IDs must be unique.")
        names = [str(r.value).strip().casefold() for r in self.rules if r.kind == "friend"]
        if len(names) != len(set(names)):
            raise ValueError("Choose each friend only once.")
        return self


class ConfirmRequest(Model):
    plan_id: Annotated[str, Field(min_length=1, max_length=200)]


class AdjustRequest(ParseRequest, ConfirmRequest):
    pass


class RuleChangeRequest(ConfirmRequest):
    token: Annotated[str, Field(min_length=1, max_length=100000)]
    accept: bool


class AlternativesRequest(ConfirmRequest):
    section_key: NonEmpty


class KeepRequest(AlternativesRequest):
    keep: bool


class SwapRequest(ConfirmRequest):
    from_key: NonEmpty
    to_key: NonEmpty


class ClassAlternative(Model):
    section: Section
    remaining_seats: int | None = None
    can_swap: bool
    reasons: list[str]
    preference_notes: list[str]


class ClassAlternatives(Model):
    plan_id: str
    current: Section
    kept: bool
    options: list[ClassAlternative]


class ExtractedRule(Model):
    kind: Literal[
        "earliest", "latest", "dayoff", "nolabs", "lunch", "friend", "latest_day", "earliest_day"
    ]
    value: Value
    source: Annotated[str, Field(min_length=1, max_length=10000)]

    @model_validator(mode="after")
    def valid(self) -> Self:
        validate_value(self.kind, self.value)
        return self


class Move(Model):
    from_key: NonEmpty
    to_key: NonEmpty


class RuleRemoval(Model):
    rule_id: Annotated[str, Field(min_length=1, max_length=200)]
    source: Annotated[str, Field(min_length=1, max_length=10000)]
    mode: Literal["explicit", "proposed"] = "proposed"


class SectionChange(Model):
    from_key: Annotated[str, Field(min_length=1, max_length=200)]
    direction: Literal["earlier", "later", "other_day", "different"]
    same_day: bool = False
    source: Annotated[str, Field(min_length=1, max_length=10000)]

    @model_validator(mode="after")
    def coherent(self) -> Self:
        if self.direction == "other_day" and self.same_day:
            raise ValueError("Moving to another day cannot also require the same day.")
        return self


class ClassTarget(Model):
    course: Annotated[str, Field(min_length=1, max_length=200)] | None = None
    kind: Annotated[str, Field(min_length=1, max_length=100)] | None = None
    day: Weekday | None = None
    start: Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")] | None = None


class ClassChange(Model):
    target: ClassTarget
    direction: Literal["earlier", "later", "other_day", "different"] = "different"
    same_day: bool = False
    source: Annotated[str, Field(min_length=1, max_length=10000)]

    @model_validator(mode="after")
    def coherent(self) -> Self:
        if self.direction == "other_day" and self.same_day:
            raise ValueError("Moving to another day cannot require the same day.")
        return self


class TimetableQuery(Model):
    topic: Literal[
        "student_identity",
        "friend_matches",
        "schedule",
        "enrolment",
        "preferences",
        "alternatives",
        "summary",
        "help",
    ]
    friends: Annotated[list[str], Field(max_length=10)] = Field(default_factory=list)
    day: Weekday | None = None
    course: Annotated[str, Field(max_length=200)] | None = None
    section_key: Annotated[str, Field(max_length=200)] | None = None
    source: Annotated[str, Field(min_length=1, max_length=10000)]


class Intent(Model):
    action: Literal[
        "build", "rules", "move", "alternatives", "class_change", "query", "undo", "unsupported"
    ]
    rules: Annotated[list[ExtractedRule], Field(max_length=30)] = Field(default_factory=list)
    move: Move | None = None
    remove_rules: Annotated[list[RuleRemoval], Field(max_length=100)] = Field(default_factory=list)
    changes: Annotated[list[SectionChange], Field(max_length=20)] = Field(default_factory=list)
    reason: Literal["ambiguous", "course_removal", "outside_catalogue"] = "ambiguous"
    query: TimetableQuery | None = None
    class_change: ClassChange | None = None

    @model_validator(mode="after")
    def coherent(self) -> Self:
        if (self.action == "class_change") != (self.class_change is not None):
            raise ValueError("Only class_change actions have a class_change request.")
        if (self.action == "move") != (self.move is not None):
            raise ValueError("Only move actions have a move target.")
        if (self.action == "alternatives") != bool(self.changes):
            raise ValueError("Only alternatives actions have relative section changes.")
        if len({c.from_key for c in self.changes}) != len(self.changes):
            raise ValueError("Request each class change only once.")
        if (self.action == "query") != (self.query is not None):
            raise ValueError("Only query actions have a timetable query.")
        if self.action in {"undo", "unsupported", "query"} and (self.rules or self.remove_rules):
            raise ValueError("This action cannot edit rules.")
        if self.action == "build" and self.remove_rules:
            raise ValueError("Building cannot remove existing preferences.")
        if len({r.rule_id for r in self.remove_rules}) != len(self.remove_rules):
            raise ValueError("A rule can be removed only once.")
        return self
