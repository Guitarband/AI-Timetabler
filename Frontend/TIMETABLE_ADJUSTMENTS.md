# Timetable adjustments

Select a class in an editable draft to compare its published alternatives. Each option
shows live remaining seats (or an explicit unknown count), named clashes, and any
preference trade-offs. A direct swap changes only that required class. Draft swaps
do not reserve seats; confirmation checks availability again.

“Keep this class” persists in `Plan.kept_sections`. The solver enforces those keys
for AI requests, direct swaps and undo. Release a kept class explicitly before moving
it. This field lives in the existing plan JSON, so no schema migration is needed.

The authenticated endpoints are `POST /alternatives`, `/swap` and `/keep`. All check
plan ownership and the current editable version. Mutations create an immutable plan
version and use the existing concurrency checks. Availability is reloaded per request.

## Basic allocation

“Fill in my timetable to allocate all my units with no clashes” is a `build` intent.
All required classes and no overlaps are mandatory solver constraints. Optional
preferences may be empty. `/parse` signals `ready_to_build`; the review card offers
Build, and `/solve` accepts an empty rule list. Unknown input and read-only questions
do not trigger that state. Course onboarding is still required.

## Contextual class requests

The planner includes up to 12 recent user/assistant messages from the active timetable
with `/parse` and `/adjust` (4,000 characters per message, 24,000 total). Saved drafts
retain their own conversations; a new timetable starts fresh. Context is request-local
and is sent as untrusted JSON data, never as system instructions. The latest message
and current timetable take priority; source quotations must still come from the latest
user message.

The AI extracts `class_change` filters (course, class type, weekday, current start).
The server resolves these against the current draft: one match continues through the
existing solver, several matches produce a specific question listing those classes,
and no match leaves the timetable unchanged. “Another time” defaults to checking a
different section; it does not require a destination or imply staying on the same day.
Follow-up identifiers retain a pending move request. Explicit read-only questions do
not move classes. Pins, capacity, clashes and version checks still apply.

## Manual checks

1. Submit the sentence above and choose **Build my timetable** without adding a rule.
2. Select a class and check the alternative's seats, clashes and preference warnings.
3. Enable **Keep this class**, close the popup, and ask the AI to move it; it must stay fixed.
4. Reload the saved draft, release the kept class and swap; all other class keys must stay unchanged.
5. Request a full or clashing option; the reply must name the blocker and offer a feasible adjustment when one exists.

Automated coverage: `Backend/tests/test_class_choices.py`, `test_basic_build.py`,
the opt-in `test_postgres.py`, and `Frontend/tests/class-choices.test.ts` plus the
authenticated tRPC transport tests. The offline mock has no live seat inventory and
labels counts as unavailable.
