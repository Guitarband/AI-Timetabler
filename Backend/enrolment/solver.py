import time
from collections import defaultdict
from uuid import uuid4

from .catalogue import Catalogue, Profile
from .errors import ApiError
from .models import (
    RELATIVE_KINDS,
    FriendMatch,
    Message,
    Plan,
    PlanSummary,
    PublishedSection,
    Rule,
    RuleScore,
    Section,
)

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]


def minutes(value: str) -> int:
    hour, minute = map(int, value.split(":"))
    return hour * 60 + minute


def hhmm(value: int) -> str:
    return f"{value // 60:02d}:{value % 60:02d}"


def overlaps(a: Section, b: Section) -> bool:
    return a.day == b.day and a.start < b.end and b.start < a.end


def label(kind: str, value: int | str) -> str:
    if kind == "earliest":
        return f"No classes before {hhmm(value)}"
    if kind == "latest":
        return f"Nothing after {hhmm(value)}"
    if kind == "dayoff":
        return f"{DAYS[value - 1]}s free"
    if kind == "nolabs":
        return "No back-to-back labs"
    if kind == "lunch":
        return f"Keep a {value}-minute lunch break"
    if kind == "friend":
        return f"Match timetable with {value}"
    if kind == "latest_day":
        day, end = map(int, value.split("@"))
        return f"Nothing after {hhmm(end)} on {DAYS[day - 1]}s"
    if kind == "earliest_day":
        day, start = map(int, value.split("@"))
        return f"No classes before {hhmm(start)} on {DAYS[day - 1]}s"
    return kind


def shared_keys(profile: Profile, name: str) -> set[str]:
    return next(
        (
            set(keys)
            for friend, keys in profile.friends.items()
            if friend.strip().casefold() == name.strip().casefold()
        ),
        set(),
    )


def relative_match(kind: str, source: PublishedSection, candidate: PublishedSection) -> bool:
    if source.group != candidate.group or source.key == candidate.key:
        return False
    if kind.endswith("_same_day") and source.day != candidate.day:
        return False
    direction = kind.removeprefix("section_").removesuffix("_same_day")
    if direction == "earlier":
        return candidate.start < source.start
    if direction == "later":
        return candidate.start > source.start
    if direction == "other_day":
        return candidate.day != source.day
    return direction == "different"


def describe_section(section: Section) -> str:
    return f"{section.code} {section.kind.lower()} {section.section} on {DAYS[section.day - 1]} {section.start}–{section.end}"


def score(
    rule: Rule,
    sections: list[Section],
    profile: Profile,
    published: dict[str, PublishedSection] | None = None,
) -> tuple[float, str]:
    kind, value = rule.kind, rule.value
    if kind in RELATIVE_KINDS:
        published = published or {}
        source = published.get(str(value))
        if source is None:
            return 0.0, "The reference section is no longer published. Review this preference."
        selected = next(
            (
                published[s.key]
                for s in sections
                if s.key in published and published[s.key].group == source.group
            ),
            None,
        )
        met = selected is not None and relative_match(kind, source, selected)
        return float(met), (
            f"Selected {describe_section(selected)}."
            if selected
            else "No section selected for this required class."
        )
    if kind == "earliest":
        good = sum(minutes(s.start) >= value for s in sections)
        return good / len(sections), f"Earliest class starts at {min(s.start for s in sections)}."
    if kind == "latest":
        good = sum(minutes(s.end) <= value for s in sections)
        return good / len(sections), f"Latest class ends at {max(s.end for s in sections)}."
    if kind == "dayoff":
        count = sum(s.day == value for s in sections)
        return (1.0 if not count else 0.0), f"{count} classes on {DAYS[value - 1]}."
    if kind == "latest_day":
        day, end = map(int, value.split("@"))
        relevant = [s for s in sections if s.day == day]
        good = sum(minutes(s.end) <= end for s in relevant)
        return (
            good / len(relevant) if relevant else 1.0,
            f"{good} of {len(relevant)} {DAYS[day - 1]} classes end by {hhmm(end)}.",
        )
    if kind == "earliest_day":
        day, start = map(int, value.split("@"))
        relevant = [s for s in sections if s.day == day]
        good = sum(minutes(s.start) >= start for s in relevant)
        return (
            good / len(relevant) if relevant else 1.0,
            f"{good} of {len(relevant)} {DAYS[day - 1]} classes start at or after {hhmm(start)}.",
        )
    if kind == "nolabs":
        labs = [s for s in sections if s.kind.casefold() == "lab"]
        adjacent = sum(
            a.day == b.day and (a.end == b.start or b.end == a.start)
            for i, a in enumerate(labs)
            for b in labs[i + 1 :]
        )
        return (0.0 if adjacent else 1.0), f"{adjacent} pairs of back-to-back labs."
    if kind == "lunch":
        # Longest uninterrupted break in 11:00-14:00 on each teaching day.
        gaps = []
        for day in sorted({s.day for s in sections}):
            cursor, longest = 660, 0
            for s in sorted((s for s in sections if s.day == day), key=lambda s: s.start):
                start, end = max(660, minutes(s.start)), min(840, minutes(s.end))
                if start >= end:
                    continue
                longest = max(longest, start - cursor)
                cursor = max(cursor, end)
            gaps.append(max(longest, 840 - cursor))
        good = sum(gap >= value for gap in gaps)
        return (
            good / len(gaps),
            f"A {value}-minute lunch break fits on {good} of {len(gaps)} teaching days (11:00-14:00).",
        )
    if kind == "friend":
        keys = shared_keys(profile, str(value))
        common = len(keys & {s.key for s in sections})
        return (
            (common / len(keys) if keys else 0.0),
            f"{common} of {len(keys)} shared classes matched."
            if keys
            else "No shared classes are available in your approved courses for this friend.",
        )
    return 0.0, f"The solver cannot evaluate the rule kind '{kind}'; it was kept for review."


def scores_for(rules: list[Rule], sections: list[Section], profile: Profile, published=None):
    result, fractions = [], []
    for rule in rules:
        fraction, note = score(rule, sections, profile, published)
        fractions.append(fraction)
        result.append(
            RuleScore(
                rule_id=rule.id,
                label=rule.label,
                status="met" if fraction == 1 else "unmet" if fraction == 0 else "partial",
                note=note,
            )
        )
    percent = round(100 * sum(fractions) / len(fractions)) if fractions else 100
    return result, percent


def solve(
    catalogue: Catalogue,
    profile: Profile,
    rules: list[Rule],
    *,
    previous: Plan | None = None,
    forced: dict[str, str] | None = None,
    required_rules: list[Rule] | None = None,
    timeout: float = 3,
    max_nodes: int = 200000,
) -> Plan | None:
    profile = catalogue.matching_profile(profile)
    published = {s.key: s for s in catalogue.available(profile)}
    forced = dict(forced or {})
    for key in previous.kept_sections if previous else []:
        section = published.get(key)
        if section is None or forced.get(section.group, key) != key:
            return None
        old = next((s for s in previous.sections if s.key == key), None)
        if old is None or (old.day, old.start, old.end, old.room) != (
            section.day,
            section.start,
            section.end,
            section.room,
        ):
            return None
        forced[section.group] = key
    groups = defaultdict(list)
    for section in catalogue.available(profile):
        if section.selectable and (
            not forced or section.group not in forced or forced[section.group] == section.key
        ):
            groups[section.group].append(section)
    needed = [
        group for code in profile.approved_courses for group in catalogue.required_groups[code]
    ]
    if any(not groups[group] for group in needed):
        return None
    previous_keys = {s.key for s in previous.sections} if previous else set()
    deadline, nodes, valid_count = time.monotonic() + timeout, 0, 0
    best, best_rank = None, None

    def visit(index: int, chosen: list[PublishedSection]):
        nonlocal nodes, valid_count, best, best_rank
        nodes += 1
        if nodes > max_nodes or time.monotonic() > deadline:
            raise ApiError(
                503, "The solver could not finish in time. Reduce the catalogue or try again."
            )
        if index == len(needed):
            if any(score(r, chosen, profile, published)[0] < 1 for r in required_rules or []):
                return
            valid_count += 1
            fit = sum(score(r, chosen, profile, published)[0] for r in rules)
            # Stable catalogue order resolves ties; adjustments favour unchanged classes.
            rank = (fit, sum(s.key in previous_keys for s in chosen))
            if best_rank is None or rank > best_rank:
                best, best_rank = list(chosen), rank
            return
        for candidate in groups[needed[index]]:
            if not any(overlaps(candidate, other) for other in chosen):
                visit(index + 1, [*chosen, candidate])

    visit(0, [])
    if best is None:
        return None
    friend_rules = [r for r in rules if r.kind == "friend"]
    matches = {
        str(rule.value).strip(): shared_keys(profile, str(rule.value)) for rule in friend_rules
    }
    sections = [
        Section(
            **s.model_dump(
                exclude={
                    "group",
                    "with_friend",
                    "shared_with",
                    "changed",
                    "selectable",
                    "remaining_seats",
                }
            ),
            with_friend=any(s.key in keys for keys in matches.values()),
            shared_with=[name for name, keys in matches.items() if s.key in keys],
            changed=bool(previous) and s.key not in previous_keys,
        )
        for s in best
    ]
    scores, match_pct = scores_for(rules, sections, profile, published)
    friends = []
    for name, keys in matches.items():
        common = len(keys & {s.key for s in sections})
        friends.append(
            FriendMatch(
                name=name,
                shared=common,
                total=len(keys),
                text=f"{common} of {len(keys)} shared classes matched with {name}."
                if keys
                else "No shared classes are available in your approved courses for this friend.",
            )
        )
    course_credits = {
        code: max(s.credits for s in sections if s.code == code)
        for code in profile.approved_courses
    }
    unmet = [s.label for s in scores if s.status != "met"]
    note = f"Not fully met: {'; '.join(unmet)}." if unmet else None
    if catalogue.demo:
        note = " ".join(
            filter(None, [note, "Fictional sample catalogue. No university seats are held."])
        )
    return Plan(
        plan_id=f"plan-{uuid4().hex}",
        version=previous.version + 1 if previous else 1,
        changed=True,
        rules=rules,
        sections=sections,
        kept_sections=list(previous.kept_sections) if previous else [],
        match_pct=match_pct,
        scores=scores,
        friend=friends[0] if friends else None,
        friends=friends,
        summary=PlanSummary(
            sections=len(sections), credits=sum(course_credits.values()), hold_minutes=0
        ),
        source_sections=len(catalogue.available(profile)),
        message=Message(
            steps=[
                f"Checked {valid_count} clash-free combinations from published sections.",
                f"Selected one section for each of {len(needed)} required classes.",
                f"Scored all {len(rules)} preferences.",
            ],
            text=f"Your draft has {len(sections)} classes and matches {match_pct}% of your preferences.",
            note=note,
        ),
    )
