"""Grounded availability checks shared by direct swaps and AI explanations."""

from .models import ClassAlternative, Section
from .solver import describe_section, overlaps, score


def inspect_option(current, source, target, profile, published):
    reasons = []
    if not target.selectable:
        reasons.append(
            "This class is full."
            if target.remaining_seats == 0
            else "This class is closed or unavailable."
        )
    if source.key in current.kept_sections:
        reasons.append(
            f"{source.code} {source.section} is kept. Turn off ‘Keep this class’ to move it."
        )
    others = [s for s in current.sections if s.key != source.key]
    for other in others:
        latest = published.get(other.key)
        if latest is None or not latest.selectable:
            reasons.append(
                f"{other.code} {other.section} is no longer available. Build a new draft to review its options."
            )
        elif (latest.day, latest.start, latest.end, latest.room) != (
            other.day,
            other.start,
            other.end,
            other.room,
        ):
            reasons.append(
                f"The published time or room for {other.code} {other.section} changed. Build a new draft to review it."
            )
        if overlaps(target, other):
            suffix = " This class is kept." if other.key in current.kept_sections else ""
            reasons.append(f"Clashes with {describe_section(other)}.{suffix}")
    candidate = [*others, target]
    notes = [
        f"Less of this preference is met: {rule.label}."
        for rule in current.rules
        if score(rule, candidate, profile, published)[0]
        < score(rule, current.sections, profile, published)[0]
    ]
    return ClassAlternative(
        section=Section(**target.model_dump(exclude={"group", "selectable", "remaining_seats"})),
        remaining_seats=target.remaining_seats,
        can_swap=not reasons,
        reasons=reasons,
        preference_notes=notes,
    )


def failure_message(current, profile, published, forced, required):
    """Describe concrete restrictions without claiming current clashes prove global infeasibility."""
    lines = []
    suggestion = None
    for source in current.sections:
        original = published.get(source.key)
        if original is None:
            lines.append(f"{source.code} {source.section} is no longer published.")
            continue
        group_options = [s for s in published.values() if s.group == original.group]
        if not any(s.selectable for s in group_options):
            lines.append(
                f"Every published option for {source.code} {source.kind.lower()} is full or closed."
            )
        if len(group_options) == 1:
            for rule in required:
                if (
                    rule.kind in {"earliest", "latest", "earliest_day", "latest_day", "dayoff"}
                    and score(rule, current.sections, profile, published)[0] < 1
                    and score(rule, [source], profile, published)[0] < 1
                ):
                    lines.append(
                        f"{describe_section(source)} has no other published time and does not meet ‘{rule.label}’."
                    )
        if source.key in current.kept_sections:
            lines.append(f"{describe_section(source)} is kept and cannot move.")
            if (original.day, original.start, original.end, original.room) != (
                source.day,
                source.start,
                source.end,
                source.room,
            ):
                lines.append(
                    f"The published time or room for kept class {source.code} {source.section} changed. Build a new draft to review the updated catalogue."
                )
        for target in group_options:
            if target.key == source.key:
                continue
            option = inspect_option(current, source, target, profile, published)
            if option.can_swap and suggestion is None:
                suggestion = f"Available adjustment instead: swap {source.code} {source.section} to {describe_section(target)}; all other classes stay in place."
                if option.preference_notes:
                    suggestion += " " + " ".join(option.preference_notes)
            # Include options relevant to the attempted change, not unrelated unavailable classes.
            candidate = [target if s.key == source.key else s for s in current.sections]
            relevant = forced.get(original.group) == target.key or any(
                score(rule, candidate, profile, published)[0]
                > score(rule, current.sections, profile, published)[0]
                for rule in required
            )
            if relevant and option.reasons:
                lines.append(f"{describe_section(target)}: {' '.join(option.reasons)}")
    if required:
        lines.insert(0, "Requested preferences: " + "; ".join(r.label for r in required) + ".")
    if not suggestion:
        suggestion = (
            "Open a kept class and turn off ‘Keep this class’ before retrying a request that moves it."
            if current.kept_sections
            else "No single-class swap is available with the other classes fixed. Try relaxing a requested time or day so several classes can move together."
        )
    return lines, suggestion
