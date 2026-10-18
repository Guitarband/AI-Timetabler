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

## Rule removal and conflicting preferences

Explicit requests such as “Remove my Friday-off rule” or “Replace my 10am start
limit with 9am” apply directly. The parser marks those removals `mode: explicit`.
Unspecified modes default to `proposed`; a new contradictory preference alone is
not permission to remove an existing one.

The backend also detects overlapping start/finish conflicts, revised limits for
the same days, and disjoint available alternatives for a targeted class. It returns
an unchanged draft with a review listing the exact rules to remove and add, plus
the reason. The student chooses **Apply changes** or **Keep existing rules**.
Independent days off and best-effort friend matches do not trigger automatic removal.
Detection is conservative; it does not prove every possible multi-rule conflict.

`POST /rule-change` accepts `{plan_id, token, accept}` through authenticated tRPC.
The signed proposal binds the reviewed intent to the owner and immutable plan ID,
expires after one hour, and applies without a second AI interpretation. Approval
rechecks availability and kept classes. An infeasible adjustment leaves the original
rules and draft intact. Successful changes can be undone through the existing history.
Review details and decisions survive saved-chat reloads; earlier-draft controls are
disabled. No database migration is needed. This flow requires the connected backend;
the offline mock does not generate rule-change proposals.

Regression coverage: `Backend/tests/test_rule_changes.py` and
`Frontend/tests/rule-changes.test.ts`.

## Manual checks

### Saved timetable lifecycle

- **Delete** asks for confirmation and removes the selected timetable and chat from
  the library. **Undo deletion** restores the most recently deleted item during
  the current page session. Deletion never cancels booked classes.
- **Edit confirmed timetable** creates a separately saved editable revision with
  the original classes, rules, kept classes and chat. The original confirmation is
  retained. Bookings change only after the revision passes validation and is confirmed.
- **Sign out** asks for confirmation. Cancel and Escape keep the session open;
  approval saves pending timetable changes before signing out. A failed save keeps
  the user signed in with an error message.

Deletion uses a tombstone in the existing snapshot JSON, with owner checks and
revision checks preventing stale tabs from restoring deleted records. No new
database migration is required. Deploy both frontend and backend for `/reopen`.

Coverage: `Backend/tests/test_reopen.py`, the booking-preservation test in
`Backend/tests/test_postgres.py`, and the saved-timetable frontend tests (including
the rollback-only PostgreSQL round trip). Browser checks use a local fixture with
the real page, persistence hook and mock planner; they do not sign out a real user.

### Timetable queries and adjustments

“What classes am I enrolled in?” is a read-only query in both real and mock modes.
Before allocation, it lists selected courses. With a draft it lists its actual
classes without changing rules, class choices or version. The real backend checks
the signed-in student's confirmed bookings for the active term first; responses
distinguish prototype bookings from draft/selected courses and university records.
The offline mock labels its answers as sample data.

For missing IT courses on a deployed site, see [deployment checks](DEPLOYMENT_CHECKS.md).

1. Submit the sentence above and choose **Build my timetable** without adding a rule.
2. Select a class and check the alternative's seats, clashes and preference warnings.
3. Enable **Keep this class**, close the popup, and ask the AI to move it; it must stay fixed.
4. Reload the saved draft, release the kept class and swap; all other class keys must stay unchanged.
5. Request a full or clashing option; the reply must name the blocker and offer a feasible adjustment when one exists.

Automated coverage: `Backend/tests/test_class_choices.py`, `test_basic_build.py`,
the opt-in `test_postgres.py`, and `Frontend/tests/class-choices.test.ts` plus the
authenticated tRPC transport tests. The offline mock has no live seat inventory and
labels counts as unavailable.
