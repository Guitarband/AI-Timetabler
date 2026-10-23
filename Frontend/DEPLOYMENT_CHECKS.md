# Real catalogue on Vercel

`NODE_ENV=production` does not select the sample catalogue. The planner's mode is
controlled by `NEXT_PUBLIC_USE_MOCK`; production now defaults to real mode when it
is missing, while development defaults to mock mode.
The offline mock has five sample courses and no IT courses. Its parser produces
the “Matched 0 phrases to rules I can check” reply.

The PostgreSQL seed includes `DEMO-IT101`, `DEMO-IT102`, and `DEMO-IT103` under
Information Technology. The 18 seeded courses were verified in the database
configured by the local `.env` files. This does not verify Vercel's private settings.

For the real planner, set these in the Vercel project's **Production** environment:

| Variable | Required value |
| --- | --- |
| `NEXT_PUBLIC_USE_MOCK` | `false` |
| `ENROLMENT_BACKEND_URL` | Base URL of the deployed Flask backend, including scheme and port |
| `ENROLMENT_BACKEND_ALLOW_HTTP` | `true` only if the backend uses public HTTP; this sends the service token unencrypted |
| `TIMETABLE_BACKEND_TOKEN` | Same secret as the Flask backend; server-only |
| `DATABASE_URL` | Database containing the course seed |
| `BETTER_AUTH_SECRET` | Stable, random secret of at least 32 characters |
| `BETTER_AUTH_URL` | `https://ai-timetabler-five.vercel.app` for the main domain |
| `TERM_ID` | `2026-fall`, matching the backend |

The Flask service needs `CATALOGUE_SOURCE=postgres`, the matching `POSTGRES_URL`
and `TERM_ID`, and its AI provider configuration. A Vercel deployment cannot reach
the Flask server on your computer at `127.0.0.1:8000`.

Before testing registration on a fresh production database, run `npm run db:deploy`
against the same `DATABASE_URL` used by Vercel. If signup and sign-in both return
HTTP 500, inspect the Vercel runtime log for that request ID. Check the database
connection, applied migrations and auth secret; the public response deliberately
does not include the database or auth-provider error.

HTTPS is required by default. Set `ENROLMENT_BACKEND_ALLOW_HTTP=true` only when
accepting that the bearer service token and request contents travel unencrypted.
For the provided backend, use `ENROLMENT_BACKEND_URL=http://168.138.104.201:8000`.

`NEXT_PUBLIC_*` values are compiled into the browser bundle. Redeploy after changing
them; restarting or refreshing an existing deployment does not replace the bundle.
Keep real-mode authentication enabled: the unverified-account production exception
is restricted to mock mode and cannot be used as a shortcut to enable the real backend.

After deployment, sign in and open Courses. Information Technology should contain
three `DEMO-IT` courses. Existing mock and real saved-timetable libraries are separate;
switching mode does not delete the mock library. Complete course selection in real mode.

Read-only seed verification (from `Backend`, with its database configured):

```powershell
.venv/Scripts/python.exe scripts/seed_onboarding_courses.py --check
```
