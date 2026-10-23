# Saved timetables

The planner saves named timetables and chat to your account. In real planner mode, the timetable you most recently save or open becomes active and can be found by other students using your name or student ID. Mock-mode timetables stay separate from real student matching.

1. Build a timetable. The planner saves it to your account as you work.
2. Change its name and choose **Save** to keep the named timetable.
3. Choose **New timetable** to start another plan.
4. Select a saved timetable and choose **Open** to make it active again.
5. Refresh the page to reopen the active timetable.

Saved timetables sync through the account database across devices. Saving does not book seats or confirm enrolment. Confirmation is a separate planner action that records prototype bookings in PostgreSQL; it does not submit enrolment to the university.

AI matching compares the most recent use of real saved workspaces with the latest solver publication. Opening or saving a workspace records use; a new solver draft can win before browser autosave completes. Matching follows the owned plan family's latest version and skips deleted, empty, wrong-term, or incomplete snapshots. If the active pointer is missing, recent valid saves are still discoverable. Complete confirmed bookings are the final fallback. Mock timetables are excluded.
