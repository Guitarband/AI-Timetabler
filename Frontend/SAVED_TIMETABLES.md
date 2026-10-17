# Basic browser timetable library

The toolbar above the planner provides a timetable name, Save, New timetable, a saved timetable selector, and Open.

1. Generate a timetable. Its plan and preferences are saved automatically in this browser.
2. Change the timetable name and choose Save to rename its saved copy.
3. Choose New timetable to start a separate plan. Existing saved timetables remain available.
4. Select a saved timetable and choose Open to return to it. Successful adjustments update that saved entry, and confirmation is saved with it.
5. Refreshing the page restores the last opened timetable. Choosing New timetable clears that selection, so refreshing keeps the new flow empty.

Storage uses localStorage, with separate keys for each account and for mock/real API mode. No credentials or chat history are stored. Restoring a timetable displays a fresh assistant message with the saved classes, preferences, scores and confirmation.

These copies stay on this browser and do not sync between devices. Clearing browser data removes them. If storage is blocked or full, the toolbar reports the failure; the current page still retains its in-memory copies. A local save does not book seats or confirm enrolment.

The saved plan ID still refers to the backend plan. Backend ownership, availability and version checks continue to apply when adjusting or confirming it. This initial implementation does not reconcile a saved copy with changes made in another browser or recover a plan whose backend record is unavailable. Opening an older confirmed timetable shows its saved confirmation, not a live enquiry about current bookings. A browser save/open does not change the timetable that other students can discover in PostgreSQL.

No automated or browser checks were run for this change, at the user's request.
