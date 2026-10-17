# Flask timetable backend

For real student name/ID lookup, course administration and capacity tracking, follow [the database setup guide](DATABASE.md). This checkout already uses PostgreSQL and has Maya/Leo seeded. Start a new timetable after switching from the earlier SQLite demo.

This implements the brief's five-call flow in **Flask**, as requested. Flask-CORS handles configured origins. DeepSeek interprets preferences and adjustments; Python selects and scores published classes. PostgreSQL stores courses, class options, student timetables, draft versions and bookings in Prisma-managed tables. Explicit file mode retains the original JSON catalogue and SQLite demo. The existing Better Auth login stays in Next.js.

## Start locally (Windows PowerShell)

1. From the repository root, enter `Backend`. Dependencies are already installed in this checkout. For a fresh checkout, install Python 3.12+ and run:

   ```powershell
   cd Backend
   py -3.12 -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.lock
   ```

   If you use `uv`, the equivalent is `uv venv --python 3.12 .venv` followed by `uv pip sync --python .venv/Scripts/python.exe requirements.lock`. The lock includes development tools; `requirements.txt` contains runtime dependencies only. On macOS/Linux use `.venv/bin/python`.

2. Prepare local configuration:

   ```powershell
   .\.venv\Scripts\python.exe scripts/configure.py --connect-frontend
   ```

   This has already been run in this checkout. It creates `Backend/.env`, generates a random service token, and sets the same token, `ENROLMENT_BACKEND_URL=http://127.0.0.1:8000`, and `NEXT_PUBLIC_USE_MOCK=false` in `Frontend/.env`. It preserves database, mail and Better Auth settings and existing backend API keys. Re-running it keeps the service token. Both `.env` files are ignored by Git.

3. Set these entries in **`Backend/.env`**:

   ```dotenv
   AI_PROVIDER=deepseek
   DEEPSEEK_API_KEY=your-api-key
   DEEPSEEK_MODEL=deepseek-flash
   ```

   Create the key in the [DeepSeek platform](https://platform.deepseek.com/). The [official API documentation](https://api-docs.deepseek.com/) lists `deepseek-flash` and its OpenAI-compatible endpoint. The implementation uses the `openai` Python SDK with `https://api.deepseek.com`, JSON output and thinking disabled. It calls DeepSeek, not OpenAI. Your DeepSeek account needs available API credit. Keep the key out of browser variables and source control.

4. Start Flask with Waitress and leave this terminal open:

   ```powershell
   .\.venv\Scripts\python.exe app.py
   ```

   The terminal logs the startup address, selected provider/storage mode, and each request's method, path, status, and duration. Errors include a traceback for backend diagnosis. Logs omit request bodies, authorization headers, account IDs, names, and API keys. Open <http://127.0.0.1:8000/health>; expect `{"status":"ok"}`. Health checks do not validate the DeepSeek key. Waitress binds to localhost by default; no Flask debug server is exposed. `LOG_LEVEL` defaults to `INFO` and can be set to `DEBUG`, `WARNING`, or `ERROR` in `Backend/.env`.

5. In a second terminal, start or restart the authenticated frontend:

   ```powershell
   cd Frontend
   npm run dev
   ```

   Open <http://localhost:3000> and sign in. For local testing without email delivery, set `AUTH_REQUIRE_EMAIL_VERIFICATION=false` in `Frontend/.env`, run the frontend in development, and create an account at `/signup`. Production still requires verification. If the terminal is already inside `Backend`, use `cd ../Frontend`. See [Frontend setup](../Frontend/README.md). Changes to `NEXT_PUBLIC_USE_MOCK` require a restart, or a rebuild for production.

## Test it

Run these from `Backend`. Automated tests make **no paid AI calls**.

1. Run Python behavior, security, persistence and AI-response validation tests:

   ```powershell
   New-Item -ItemType Directory -Force instance | Out-Null
   .\.venv\Scripts\python.exe -m pytest -q --basetemp=instance/pytest
   ```

   `instance/pytest` is disposable test storage. Pytest clears its chosen base directory on each run; never point `--basetemp` at your application database directory.

2. Check Python style and imports:

   ```powershell
   .\.venv\Scripts\python.exe -m ruff check .
   .\.venv\Scripts\python.exe -m ruff format --check .
   ```

3. Run the original frontend contract tests against a real, temporary Flask HTTP server:

   ```powershell
   .\.venv\Scripts\python.exe scripts/contract_check.py
   ```

   This starts and stops its own localhost server, uses an explicit offline fixture parser and an isolated database, and runs the original UI assertions. It needs Node/npm and the reference frontend's dependencies. They are present in this checkout; on a fresh checkout run `npm ci` in `Full Frontend Verion V.1/Enrolment_Assistant/Enrolment_Assistant`. Twelve HTTP contract tests run; the original mock-only example test is skipped. No changes are made to your normal provider or database settings.

4. With your API running and key configured, test the live five-call journey:

   ```powershell
   .\.venv\Scripts\python.exe scripts/smoke.py
   ```

   This makes two paid AI requests when `AI_PROVIDER=deepseek`, creates a test plan and local confirmation, and verifies confirmation retries return the same result. It prints no keys. Use `--url` for another local endpoint and `--user-id` for a configured non-demo profile. The live DeepSeek journey was verified on 16 October 2026: preferences parsed, the workshop moved in version 2, and confirmation retries returned the same record.

5. Test the browser flow. Enter:

   ```text
   No classes before 10, keep Fridays free, and match my timetable with Maya Okafor.
   ```

   Review the rules, build a timetable, then request `Can you move my Wednesday workshop earlier? I start work at 15:00.` Confirm the new version. The name shown in the portal and greeting comes from your Better Auth session.

For an entirely offline demo, set `AI_PROVIDER=fixture` in `Backend/.env` and restart Flask. It recognizes only the exact two sentences above, `undo`, `undo the last change`, and `Put me in Maya's seminar.` Other input returns no understood rules/change. This mode is deliberately limited and is **never** silently used when DeepSeek fails. Set it back to `deepseek` for natural language input.

## HTTP contract

For more precise live AI checks, run `.\.venv\Scripts\python.exe scripts/probe_ai.py` from `Backend`. This makes eleven paid interpretation requests against the running local API using fictional data, verifies specific moves, impossible constraints, undo, replacements and weekday scope, and writes results to ignored `instance/live-probe.json`. It exits unsuccessfully if its assertions fail. See [the live test report](../docs/product-audit/live-testing.md) for observed results and remaining limits.

Every endpoint except `/health` and CORS preflight requires `Authorization: Bearer <TIMETABLE_BACKEND_TOKEN>` and `X-User-Id`. The optional `X-User-Name` is URL-encoded by Next.js. The trusted frontend server derives both identity fields from the verified session. Never expose the shared service token to the browser; CORS does not authenticate a caller.

| Endpoint | JSON body | Result |
| --- | --- | --- |
| `GET /context` | None | Session name, term, approved-course and published-section counts, authorized friends, greeting |
| `POST /parse` | `{"text":"..."}` | Validated rules with exact source excerpts and a review message |
| `POST /solve` | `{"rules":[...]}` | Version 1, published sections, per-rule scores, match percentage and summary |
| `POST /adjust` | `{"plan_id":"...","text":"..."}` | New ID/version on a change; same ID/version/sections for questions or unapplied changes |
| `POST /confirm` | `{"plan_id":"..."}` | Persistent confirmation; repeated calls return exactly the same record |

Confirm can follow solve immediately; adjustment is optional. Only the latest version can change or be confirmed. Concurrent changes cannot overwrite each other. A confirmed plan is immutable; build a new draft to explore another timetable. Undo creates the next version using the previous version's rules and sections.

Response shapes match `Frontend/src/lib/enrolment-contract.ts`. Errors always contain `{"detail":"readable explanation"}`. Invalid input returns 400/413/415/422; bad service authentication 401; unknown or other-account plans 404; stale/confirmed drafts 409; invalid AI output/provider rejection 502; missing AI configuration, exhausted quota, solver capacity or unavailable storage 503; provider timeout 504. The Next.js proxy preserves actionable messages for supported status codes.

Questions such as “Which of my classes currently match with Maya?”, “What are my Wednesday classes?”, “Why is my score below 100%?” and “What other seminar sections are available?” use a read-only `query` intent. DeepSeek identifies the topic and filters; the server writes the answer from the saved draft and currently permitted friend data. Questions never invoke the solver, save a plan, or increment its version. Questions before a draft exists explain how to build one; help questions describe supported actions. This is timetable assistance, not an open-ended general knowledge chatbot. The explicit offline fixture mode does not interpret these questions.

Run `.\\.venv\\Scripts\\python.exe scripts/probe_queries.py` from `Backend` with both services running and the existing fictional test account from `probe_friends.py`. It makes ten paid AI requests, checks eight questions leave the draft unchanged, then verifies an actual adjustment still works. See [query and responsive checks](../docs/product-audit/query-responsive.md).

## Environment reference

| Variable | Purpose / default |
| --- | --- |
| `TIMETABLE_BACKEND_TOKEN` | Required random secret, at least 32 characters; identical in both apps |
| `AI_PROVIDER` | `deepseek`; `fixture` is an explicit offline sample mode |
| `DEEPSEEK_API_KEY` | Required for live `/parse` and `/adjust` |
| `DEEPSEEK_MODEL` | `deepseek-flash`; override if your provider account uses another compatible model |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com`; must use HTTPS |
| `DEEPSEEK_TIMEOUT_SECONDS` | 20-second HTTP operation timeout; no automatic SDK retries |
| `CORS_ORIGINS` | Comma-separated exact origins; defaults to localhost and 127.0.0.1 on port 3000; no wildcard |
| `HOST` / `PORT` | `127.0.0.1` / `8000` |
| `CATALOGUE_PATH` | `data/catalogue.json`, relative to Backend |
| `CATALOGUE_SOURCE` | `postgres` for database lookup/capacity; `file` for the original JSON/SQLite demo |
| `POSTGRES_URL` | Backend-only PostgreSQL connection, same database as Prisma's `DATABASE_URL` |
| `TERM_ID` | Active database term; seeded value `2026-fall` |
| `DATABASE_PATH` | `instance/enrolment.sqlite3`, relative to Backend |
| `SOLVER_TIMEOUT_SECONDS` | 3-second search limit |
| `MAX_SOLVER_NODES` | 200000 search nodes; returns an error instead of claiming an incomplete search is optimal |
| `SWAP_WINDOW_DAYS` | 14; a local confirmation date, not a university policy |

Environment variables supplied by your host take precedence over `.env`. For deployment, set the public frontend origin in CORS, use HTTPS between services, keep the token server-side, and mount persistent storage for SQLite. A public deployment also needs infrastructure request limits/rate limiting; this backend does not supply an internet-facing gateway.

## Catalogue, scoring and current boundaries

The paragraphs below describe the original **file mode**. Database mode uses real account name/ID lookup, complete seeded timetables and prototype seat bookings; see [DATABASE.md](DATABASE.md). Old three-class fixture probes are not the expected results for database mode.

The supplied catalogue is fictional: five approved courses, eight required classes and ten published alternatives. Counts come from the file, not the brief's illustrative numbers. Confirmations are local records; there is no registrar integration, seat reservation or enrolment submission. `hold_minutes` is therefore zero.

Each course has required groups (such as lecture and workshop). The solver chooses exactly one published section per group, excludes clashes, and maximizes the sum of rule satisfaction. Ties favor unchanged classes during adjustments, then stable catalogue order. Credits count each course once using its largest section credit value.

Earliest/latest rules score the proportion of classes meeting the time; day off and adjacent-lab rules are binary; lunch measures the longest uninterrupted break within 11:00–14:00 on teaching days. Friend matching measures shared section keys. `latest_day` and `earliest_day` support weekday-specific limits. The match percentage is the rounded mean of all rule scores. Unknown rule kinds survive unchanged and are scored unmet with an explanation. Explicit adjustments may trade off older soft preferences; newly requested rules must be fully met or the existing plan is returned unchanged. Explicit replacements/removals identify existing rule IDs and quote the user's request; unrelated rules survive, and undo restores removed rules. Equivalent AI-generated duplicates are canonicalized before scoring to avoid inflating the match percentage.

To replace sample data, edit `data/catalogue.json` (or configure a new file), set `demo:false`, and add `students` entries keyed by the **Better Auth user ID**. Each profile declares `approved_courses` and `friends` containing only explicitly authorized shared section keys. Missing profiles then return 404 instead of inheriting demo courses. Restart the backend after catalogue changes. The PostgreSQL peer-sharing workflow is not automatically synchronized into this file; a real catalogue/permission adapter is needed before using actual student records.

Conversational adjustments such as “Friday is too early” and “remove my Friday seminar” now use a structured `alternatives` intent. The solver searches the same required class group for an earlier/later time, another day, or a different section. Explicit same-day restrictions are respected. These become scored `section_*` rules referencing the original published section, so no clock time is guessed and the preference survives later adjustments. New relative/time constraints must be met; friend matching remains best effort. A required class is moved, never silently deleted. Replies explain the exact move, unavailable alternatives, or the clarification needed. See [live adjustment tests](../docs/product-audit/conversational-adjustments.md) and run `scripts/probe_adjustments.py` with both services running to repeat the ten paid AI checks.

DeepSeek receives the student's text, relevant published sections, permitted friend data and current plan details. Service tokens, account IDs and account email addresses are not included. Text supplied by a student can itself contain personal information. The server validates JSON, source excerpts and section keys; the model never writes SQL or generates timetable sections. Natural-language interpretation remains probabilistic, so students review parsed rules before solving.

Code is separated into `enrolment/ai.py`, `solver.py`, `storage.py`, `service.py`, and the Flask factory in `enrolment/__init__.py`. Existing databases are created automatically when absent; no destructive schema migration is performed. The separate legacy `timetable.calculate` placeholder is not part of these five endpoints.
