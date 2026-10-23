# Database-backed student matching and class availability

Try `Match my timetable with student ID 32000001` or `Match my timetable with Maya and Leo equally` in a **new** timetable at http://localhost:3000.

This checkout is configured for PostgreSQL. Migration `20261016_database_planner` and the Maya/Leo seed have been applied. Your existing account and the existing test account have the five sample courses assigned. Earlier SQLite drafts remain on disk, but are not copied into PostgreSQL; start a fresh draft after switching modes.

## How matching works

1. DeepSeek extracts a name or student ID from the prompt as a structured friend reference. It does not issue SQL or receive the complete student directory.
2. Flask queries the same PostgreSQL database managed by Prisma. Numeric IDs match exactly. Names match case-insensitively, preferring an exact full name, then a whole-name prefix such as `Maya`.
3. An ambiguous name returns candidate names/IDs and asks for a student ID. Unknown students, your own ID, and students without a saved timetable get specific messages. The system never chooses an arbitrary duplicate.
4. The backend compares real saved workspace use timestamps with the latest planner publication and selects the newest complete valid timetable for the active term. Opening an older workspace makes it recent again. Saved plans follow their owned family head; imported snapshots are validated against current class options and approvals. Deleted or incomplete copies are skipped, missing active pointers do not hide saves, and complete confirmed bookings are the final fallback. A resolved preference includes the name and ID, for example `Maya Okafor [32000001]`, so later requests keep referring to the same account.
5. The solver compares exact class-option IDs and maximizes matches while retaining every required class, avoiding clashes and considering the other preferences. A question such as `Which classes match student 32000001?` returns an answer without saving a new draft.

**Prototype sharing policy:** any authenticated planner user can match another student's saved timetable by name or ID, without a friendship or sharing grant. This is separate from the older peer-request APIs, whose permission checks remain in place. Only student records with a student ID are searchable by name. No passwords, emails or session tokens are passed to DeepSeek. The greeting explains that saved drafts are discoverable. Add grant enforcement to the directory adapter before changing this prototype policy.

Matching uses the active **draft**, which may differ from confirmed enrolment. Saving or opening a real saved timetable makes that draft discoverable immediately. It does not reserve seats or change existing bookings.

Identity questions are separate: `Who is student 32000001?` returns `Student 32000001 is Maya Okafor.` You can also ask `What is Maya Okafor's student ID?`. These lookups return only the name and student ID, work before building a draft, and do not require the target to have a timetable. They do not add matching preferences or change a plan. Unknown or ambiguous references return a lookup explanation instead of guessing.

## Prisma models

The source of truth is `Frontend/prisma/schema.prisma`; the Python adapter uses those tables through parameterized psycopg queries. Prisma owns migrations and the generated client remains usable from Next.js.

| Model | Purpose |
| --- | --- |
| `AcademicTerm`, `Course` | Term identity and course code/title/credits |
| `CourseClass` | A required class type within a course and term, such as lecture or lab |
| `ClassOption` | Alternative weekly weekday/time/room, capacity and enabled status |
| `CourseApproval` | Courses the authenticated student is allowed to timetable |
| `StudentTimetable`, `TimetableEntry` | Latest saved draft with one chosen option per required class |
| `ClassEnrolment` | Confirmed bookings; occupancy is counted from these rows |
| `PlanFamily`, `PlannerPlan` | Account-owned immutable draft versions, head and idempotent confirmation |

Composite foreign keys prevent an option being assigned to the wrong required class or a timetable entry to the wrong term. Unique constraints prevent duplicate student/class bookings. SQL checks validate capacity, credits and weekday/time ranges. This planner currently supports Monday–Friday, with one weekly meeting per option.

## Capacity behavior

- An option is selectable when enabled and occupancy is below capacity. A student may retain a seat they already occupy, even when everyone else's availability is zero.
- Full or disabled options stay in the published catalogue for explanations, but the solver cannot select them. Draft saving rechecks availability after solving.
- Confirmation locks the student and affected options, rechecks current class times, course assignments and capacity, and replaces that student's bookings in the active term in one transaction. Failure rolls everything back.
- Retrying a successful confirmation returns its original reference without booking twice. Two students competing for the last seat cannot both succeed.
- Database triggers enforce capacity for direct Prisma/SQL writes as well. Capacity cannot be reduced below current occupancy. Use `enabled=false` to close an option to selection without erasing existing bookings.

## Set up another checkout

1. Install frontend dependencies and configure its existing `DATABASE_URL`, then run from `Frontend`:

   ```powershell
   npm run db:deploy
   npm run db:generate
   ```

2. From `Backend`, install dependencies and connect the planner to that database:

   ```powershell
   .\.venv\Scripts\python.exe -m pip install -r requirements.lock
   .\.venv\Scripts\python.exe scripts/configure.py --connect-frontend --postgres
   ```

   Set `DEEPSEEK_API_KEY` in the ignored `Backend/.env`. The helper copies the existing frontend database URL to `POSTGRES_URL` without printing it. `CATALOGUE_SOURCE=postgres` selects database mode; `TERM_ID=2026-fall` selects the sample term. `CATALOGUE_SOURCE=file` retains the original explicit JSON/SQLite demo mode.

3. Seed the fictional students:

   ```powershell
   .\.venv\Scripts\python.exe scripts/catalogue_admin.py seed
   ```

   The standalone SQL is [sql/seed_maya_leo.sql](sql/seed_maya_leo.sql), suitable for running in a PostgreSQL SQL editor after migrations. It creates Maya `32000001`, Leo `32000002`, five courses, eight required class types, eleven time options and their bookings. Each student has a complete eight-class timetable; this supersedes the older three-class JSON friend samples. `writ-w99-full` has zero capacity to demonstrate exclusion. The seed creates no passwords or sign-in accounts, refuses conflicting sample IDs, and preserves existing records on repeat runs.

4. Assign the sample courses to a registered student, then start both services:

   ```powershell
   .\.venv\Scripts\python.exe scripts/catalogue_admin.py assign --student-id 12345678 "PSYC 1010" "STAT 2010" "BIOL 1020" "WRIT 1000" "PHIL 1100"
   .\.venv\Scripts\python.exe app.py
   ```

   Replace the ID with the account being configured. Administrators can use `--user-id` for an account without a student ID. New accounts do not automatically receive every course. Run `npm run dev` from `Frontend` in a separate terminal.

## Add courses, classes and alternative times

From `Backend`, copy [data/additional_course.example.json](data/additional_course.example.json) and edit it. Each course lists required group IDs; each section is a possible time for one group. The `capacities` map supplies a nonnegative seat count for every option.

```powershell
.\.venv\Scripts\python.exe scripts/catalogue_admin.py import data/additional_course.example.json
.\.venv\Scripts\python.exe scripts/catalogue_admin.py assign --student-id 12345678 "COMP 1000"
.\.venv\Scripts\python.exe scripts/catalogue_admin.py availability
.\.venv\Scripts\python.exe scripts/catalogue_admin.py capacity comp-l01 50
```

The example adds one computing course with two lecture times and two lab times; one lab has zero capacity. Import is transactional and updates supplied options while preserving unlisted courses/classes. IDs cannot be reassigned across courses or terms. Changing class times invalidates old drafts at confirmation and requires rebuilding. These are administrator commands requiring database credentials; no public catalogue-editing endpoint is exposed.

## Verification

Run ordinary offline tests from `Backend`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q --tb=short --basetemp=instance/pytest-offline
```

Database integration tests create a random isolated schema, exercise real transactions, then remove only that schema. They do not alter normal application rows:

```powershell
$env:RUN_POSTGRES_TESTS="1"
.\.venv\Scripts\python.exe -m pytest tests/test_postgres.py -q --tb=short --basetemp=instance/pytest-postgres
Remove-Item Env:RUN_POSTGRES_TESTS
```

With both services running, `scripts/probe_database.py` tests name lookup, student-ID lookup, combined matching, an ID-based question and a missing student through Better Auth, Next.js, Flask and live DeepSeek. It reuses the existing fictional test login in ignored instance storage and makes paid AI calls. It saves drafts but never confirms enrolment. Earlier fixture-based probes expect the old three-class friend data; use this database probe for the new mode.

`scripts/probe_identity.py` uses the same test login to check identity questions before and after building, name-to-ID lookup, missing IDs, unchanged draft versions, and the distinction between identity and class-match questions. It makes live AI calls and saves one test draft without confirming it.

Do not use the old fixed `smoke-student` identity in database mode; every caller needs an actual account with assigned courses. No university enrolment system is connected: confirmations book seats only in this prototype's database.
