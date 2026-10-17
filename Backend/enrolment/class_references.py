"""Resolve partial class descriptions against the student's current draft."""

import re

from .models import Message, SectionChange
from .solver import describe_section


def normalized(value):
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def resolve_change(request, plan):
    target = request.target
    matches = [
        section
        for section in plan.sections
        if (target.course is None or normalized(section.code) == normalized(target.course))
        and (
            target.kind is None
            or normalized(section.kind).removesuffix("s")
            == normalized(target.kind).removesuffix("s")
        )
        and (target.day is None or section.day == target.day)
        and (target.start is None or section.start == target.start)
    ]
    if len(matches) == 1:
        return SectionChange(
            from_key=matches[0].key,
            direction=request.direction,
            same_day=request.same_day,
            source=request.source,
        ), None
    if not matches:
        return None, Message(
            text="No class in your current draft matches that description. Which course or class time did you mean? Your draft is unchanged.",
            steps=[describe_section(s) for s in plan.sections[:5]],
        )
    return None, Message(
        text=f"{len(matches)} classes match that description. Which one should I move? Reply with its course code or start time. Your draft is unchanged.",
        steps=[describe_section(s) for s in matches[:5]],
        note=f"Showing 5 of {len(matches)} matches; add a weekday or class type to narrow them down."
        if len(matches) > 5
        else None,
    )
