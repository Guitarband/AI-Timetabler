# DTE205 Timetable Project — Report Sections Draft

## Scope and evidence note

This draft uses the Monash app in `Frontend/` as the implementation baseline. The separate `Full Frontend Verion V.1/` folder describes a Northgate University frontend proof of concept, so its features are not counted as implemented in the Monash app. No approved requirements list or consultation records were present in the project files reviewed. The five requirements below are therefore a proposed set inferred from the current app scope; confirm them against the team's agreed brief before submission.

## 1. Significant requirements and user benefits

The benefits below are expected benefits based on the feature purpose. The repository does not contain user research or outcome data that confirms them.

| # | Significant requirement | Evidence and current status | Expected user benefit | Validation outcome |
|---|---|---|---|---|
| 1 | Restrict protected functions to verified Monash accounts. Require a student ID for student accounts and keep all protected operations behind a verified session. | Account screens and server-side checks are present. Security tests cover Monash email domains, verification, and protected procedures. Registration and recovery require the configured email-delivery service. A student ID is format-checked but is **not** verified against Monash records. See `Frontend/README.md`, `Frontend/src/trpc/routers/auth.ts`, and `Frontend/tests/security.test.ts`. | Gives the intended Monash community a controlled account boundary and reduces unauthorised access to personal settings. | **Implemented with setup and identity limits.** Email delivery must be configured; do not describe student ID as institutional identity verification. |
| 2 | Let each user save schedule constraints: earliest start, latest finish, preferred and avoided days, maximum campus days, and whether friend matching is prioritised. | The database model and authenticated preference read/write procedures support these fields and validate conflicting days/times. No preference settings screen is present. See `Frontend/prisma/schema.prisma` and `Frontend/src/trpc/routers/preferences.ts`. | Could reduce repeated manual decisions and make a proposed schedule better fit a student's week. | **Partially implemented.** Storage and API exist; students need a user-facing preferences flow. |
| 3 | Let users request, accept or decline, list, and remove Monash friend connections. | Friendship records and authenticated procedures exist. No friend-management screen is present. See `Frontend/prisma/schema.prisma` and `Frontend/src/trpc/routers/friends.ts`. | Could make it easier for students who choose to coordinate classes with people they know. | **Partially implemented.** API exists; user-facing flow is still needed. |
| 4 | Require the timetable owner to decide whether a peer may access their timetable, and block peer access unless that permission is accepted or partial. Let the owner change the decision and the requester cancel. | The peer-request API supports accept, partial, deny, change, and cancel. The peer-view procedure checks for a grant, but returns an empty object; timetable entries and peer-access screens are not implemented. See `Frontend/src/trpc/routers/peer-data.ts`, `Frontend/src/trpc/routers/timetable.ts`, and `Frontend/README.md`. | Gives timetable owners control over whether and how their information is shared. | **Partially implemented.** Consent states and the access gate exist; no timetable data is returned yet, and “partial” sharing needs a defined data scope. |
| 5 | Allow an authenticated user to request timetable calculation using their saved preferences and authorised peer data, then show the resulting plan and any relevant limitations. | The calculation procedure sends the verified caller's ID to a configured backend service. The calculation engine, returned timetable, display flow, and Allocate+ import are not implemented in this project. See `Frontend/src/trpc/routers/timetable.ts`, `Frontend/src/lib/timetable-backend.ts`, and `Frontend/README.md`. | Could help students compare class options against their constraints without assembling the whole timetable manually. | **Not yet met end to end.** The service handoff is an integration hook; a real result is needed before claiming this benefit. |

### Requirements conclusion

The five requirements fit the current product direction, but they are not all complete. Account access is implemented with the student-ID limitation above. Preference, friendship, and consent capabilities exist mainly as API and data foundations, while timetable calculation is only a backend handoff. User benefits should be reported as intended benefits until consultation or usability evidence confirms them.

## 2. Introduction — draft

Monash students must select class sessions that fit both their course requirements and their individual weekly constraints. A useful timetable may need to account for acceptable start and finish times, preferred or unavailable days, limits on campus attendance, and—where students choose—coordination with friends. The DTE205 project is developing a web application to support this planning while giving users control over access to their timetable information.

The current Monash implementation provides verified-account flows and API foundations for storing preferences, managing friend connections, handling peer-access decisions, and requesting a timetable calculation. It does not yet generate or display a timetable, return peer timetable entries, or import Allocate+ data. The project therefore aims to establish and evaluate a privacy-conscious planning workflow; claims that it saves time or improves enrolment decisions remain hypotheses until tested with students.

## 3. Project goals — draft

1. **Protect user accounts and data.** Support Monash account registration and verification, and require an authenticated, verified session for protected operations. The project checks student-ID format but does not verify IDs against Monash records.
2. **Capture each student's scheduling needs.** Store time-window, day, campus-day, and friend-priority preferences, with validation that prevents contradictory values. Add a usable screen for setting and revising these preferences.
3. **Support voluntary peer coordination.** Provide a clear friend-request flow and let timetable owners accept, limit, deny, or later change peer access.
4. **Deliver a useful timetable result.** Connect the saved preferences and consented peer data to a calculation service, then present the result and explain when a requested constraint cannot be met.
5. **Check the user value with students.** Consult intended users about their current enrolment process, important scheduling constraints, peer-sharing expectations, and whether the proposed workflow helps. Use recorded feedback to revise priorities and report benefits only where the evidence supports them.

## 4. Consultation findings — evidence-limited draft

No interview notes, survey results, workshop records, observation notes, or usability findings were found in the project files reviewed. For that reason, this report cannot yet state what students said or claim that the proposed benefits have been confirmed.

The current product encodes three assumptions that should be checked with Monash students: (1) students want to express timetable constraints such as time windows and preferred or avoided days; (2) some students value coordinating classes with friends; and (3) students want explicit control over peer access to timetable information. These are visible in the preference fields, friendship procedures, and peer-access decisions, but they are design assumptions—not consultation findings.

**To finalise this section, add the consultation method, dates, participant count, anonymised themes or quotes, and the design decisions that changed as a result.** A safe final paragraph can follow this pattern:

> Consultation was conducted with [number and type of participants] on [date(s)] using [method]. The main themes were [theme 1], [theme 2], and [theme 3], supported by [brief anonymised evidence]. In response, the team [specific requirement or design change]. The consultation also identified [remaining concern or limitation].
