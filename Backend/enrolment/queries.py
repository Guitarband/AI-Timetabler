"""Grounded answers to read-only questions; no model prose or plan mutations."""

from .alternatives import inspect_option
from .models import Message, Plan, TimetableQuery
from .solver import DAYS, describe_section, shared_keys


def answer_query(query: TimetableQuery, plan: Plan | None, catalogue, profile) -> Message:
    def matches(section):
        return (
            (query.day is None or section.day == query.day)
            and (query.course is None or section.code == query.course)
            and (query.section_key is None or section.key == query.section_key)
        )

    def answer(title, lines=()):
        # Long answers use the existing factual list so text stays within the API limit.
        text = "\n".join([title, *(f"• {line}" for line in lines)])
        return Message(
            text=text if len(text) <= 1000 else title,
            steps=[] if len(text) <= 1000 else list(lines),
        )

    if query.topic == "help":
        return answer(
            "I can answer questions about your timetable, shared classes, class times and rooms, preferences, or published alternatives. Ask me to move a class when you want a change, or name a rule to remove it. If a rule-change proposal is waiting, choose Apply changes or Keep existing rules on that proposal. I can't drop required courses or look up information outside this planner."
        )
    if query.topic == "enrolment":
        if plan:
            return answer(
                "Classes in your current draft (not confirmation of enrolment):",
                [
                    f"{describe_section(s)} · {s.room}"
                    for s in sorted(plan.sections, key=lambda s: (s.day, s.start, s.code))
                    if matches(s)
                ],
            )
        titles = {s.code: s.title for s in catalogue.available(profile)}
        return answer(
            "Your selected courses (class times have not been allocated in this conversation):",
            [
                f"{code} — {titles.get(code, code)}"
                for code in profile.approved_courses
                if query.course is None or query.course == code
            ],
        )
    if plan is None:
        return answer(
            "Build a timetable first so I can answer questions about your classes. Tell me your preferences, review the rules, then choose ‘Build my timetable’."
        )
    selected = sorted(plan.sections, key=lambda s: (s.day, s.start, s.code))
    if query.section_key and query.section_key not in {s.key for s in selected}:
        return answer(
            "That class is not in your current draft. Use the course code or day shown in your timetable."
        )
    if query.course and query.course not in {s.code for s in selected}:
        return answer(
            "That course is not in your current draft. Use a course code shown in your timetable."
        )
    sections = [
        s
        for s in selected
        if (query.day is None or s.day == query.day)
        and (query.course is None or s.code == query.course)
        and (query.section_key is None or s.key == query.section_key)
    ]
    scope = f" on {DAYS[query.day - 1]}" if query.day else ""
    if query.course:
        scope += f" for {query.course}"
    if query.topic == "friend_matches":
        names = query.friends or [str(r.value) for r in plan.rules if r.kind == "friend"]
        if not names:
            return answer(
                "No friends are selected for matching in this draft. Ask about a friend whose timetable is shared with your account."
            )
        lines = []
        for requested in dict.fromkeys(names):
            normalized = requested.strip().casefold()
            matches = [name for name in profile.friends if name.casefold() == normalized]
            if not matches:
                matches = [
                    name for name in profile.friends if name.split()[0].casefold() == normalized
                ]
            if len(matches) != 1:
                lines.append(
                    f"{requested}: no uniquely identified shared timetable is available to your account. Use the full name of a shared friend."
                )
                continue
            name = matches[0]
            common = [s for s in sections if s.key in shared_keys(profile, name)]
            lines.append(
                f"{name}: {len(common)} matching {'class' if len(common) == 1 else 'classes'}{scope}."
            )
            lines.extend(describe_section(s) for s in common)
        return answer("Here are the matches in your current draft:", lines)
    if query.topic == "schedule":
        return answer(
            f"Your classes{scope}:" if sections else f"You have no classes{scope} in this draft.",
            [f"{describe_section(s)} · {s.room}" for s in sections],
        )
    if query.topic == "preferences":
        return answer(
            f"Your current preference match is {plan.match_pct}%. Each rule contributes equally; partial matches receive partial credit.",
            [f"{score.label}: {score.status}. {score.note}" for score in plan.scores],
        )
    if query.topic == "alternatives":
        available = {s.key: s for s in catalogue.available(profile)}
        lines = []
        for section in sections:
            source = available.get(section.key)
            alternatives = [
                s
                for s in available.values()
                if source and s.group == source.group and s.key != source.key
            ]
            if not alternatives:
                lines.append(f"{section.code} {section.kind.lower()}: no other published section.")
            for alternative in alternatives:
                option = inspect_option(plan, section, alternative, profile, available)
                details = (
                    " ".join(option.reasons + option.preference_notes)
                    or "Fits around your other current classes."
                )
                lines.append(f"{describe_section(alternative)} — {details}")
        return answer(
            "Published alternatives (your draft has not changed):",
            lines or ["No classes match that question."],
        )
    free_days = [DAYS[day - 1] for day in range(1, 6) if all(s.day != day for s in selected)]
    return answer(
        f"Draft v{plan.version}: {len({s.code for s in selected})} courses, {len(selected)} classes, {plan.summary.credits} credits, {plan.match_pct}% preference match.",
        [
            f"Days without classes: {', '.join(free_days) if free_days else 'none'}.",
            f"Earliest start: {min(s.start for s in selected)}. Latest finish: {max(s.end for s in selected)}.",
        ],
    )
