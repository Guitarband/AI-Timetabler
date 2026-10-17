# Course onboarding

Implemented at `/courses`. After a successful login, users who have not completed onboarding for the current term go here. Returning users continue to their timetable. The Courses navigation link always reopens the picker.

A user who opens `/` directly can ask a question before selecting courses. The assistant responds with text and a **Choose courses** button. The conversation is saved before navigation; the question is restored to the composer after onboarding when session storage is available.

## Activation

The migration `20261018_course_onboarding` was applied to the configured database on 17 October 2026. It adds `course.faculty`, `course.description`, and the account/mode/term-scoped `course_onboarding` table. It also adds metadata for the bundled fictional catalogue. Existing accounts, course times, saved timetables and enrolments remain intact.

For another environment, deploy from `Frontend`:

```powershell
npm run db:deploy
npm run db:generate
```

Set `TERM_ID` in the frontend server environment to the same value as the backend (`2026-fall` by default). Real mode requires the PostgreSQL catalogue shared with the backend; file-based backend demo catalogues do not support account-owned course selections. Use `NEXT_PUBLIC_USE_MOCK=true` for the frontend demo.

## Course data and saving

The real picker reads course metadata and every published class option from PostgreSQL. It groups by faculty and supports text search, faculty and availability/selection filters, and code/name/credit sorting within each faculty. Courses whose required classes have no enabled options cannot be selected. The solver continues to validate actual capacity and clashes.

Saving the selection updates the planner's existing `course_approval` rows in the same transaction as onboarding completion. In this prototype these rows represent the courses to plan; this is not an institutional approval or a seat booking. Users can select published courses without administrator assignment. Courses with confirmed enrolments cannot be removed through this page.

Changing courses clears the active timetable pointer so the next visit starts fresh. Saved timetables and their conversations remain in the library. An older timetable with a different course set can still be viewed; the assistant offers a new timetable before adjustment or confirmation.

The modal uses a 1:3 details/timetable split on desktop and stacked sections on narrow screens. All alternative timings appear, with separate columns for overlapping options, dynamic time bounds, weekend support, and a text list. The native dialog supports focus trapping, Escape, close/backdrop dismissal and focus restoration.

## Importing faculty and descriptions

`Backend/scripts/catalogue_admin.py import` accepts an optional top-level `course_metadata` object alongside the existing catalogue data and capacities:

```json
{
  "course_metadata": {
    "FIT1001": {
      "faculty": "Information Technology",
      "description": "The published description of this course."
    }
  }
}
```

Omitted metadata preserves existing values. Courses without metadata appear under Other faculties with an explicit description-unavailable message.

## Added fictional courses

The configured PostgreSQL catalogue now includes 18 additional courses: three each in Arts, Science, Information Technology, Engineering, Business and Economics, and Medicine, Nursing and Health Sciences. All codes start with `DEMO-`; descriptions and rooms explicitly identify the data as fictional. Each course has six credit points and two required class types, each with two alternative times: 36 required classes and 72 published options in total.

The repeatable seed script preserves existing courses, account selections and bookings. From the repository root:

```powershell
# Validate the fixture without touching the database.
.\Backend\.venv\Scripts\python.exe Backend/scripts/seed_onboarding_courses.py
# Add missing demo rows; existing rows are never overwritten.
.\Backend\.venv\Scripts\python.exe Backend/scripts/seed_onboarding_courses.py --apply
# Verify the committed rows in the active term.
.\Backend\.venv\Scripts\python.exe Backend/scripts/seed_onboarding_courses.py --check
```

These additions are visible in the PostgreSQL-backed picker (`NEXT_PUBLIC_USE_MOCK=false`); the separate browser-only mock fixture is unchanged.

## Verification

`tests/courses.test.ts` covers filtering, sorting, overlap layout, persisted assistant actions, account isolation, selection validation, solver course-list updates, confirmed-course protection and mock plan restoration. Browser checks use a temporary fixture harness with mocked auth/API boundaries, covering filters, selection, save navigation, desktop ratio and mobile layout. The migration and the additional fictional catalogue have now been deployed to the configured database.

TypeScript and the changed-file Biome checks pass. The default Turbopack build encounters a CSS worker startup failure in this Windows environment; `next build --webpack` is the build verification fallback.
