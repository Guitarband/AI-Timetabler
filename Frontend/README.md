# Timetable

A Monash coursework app for planning classes around preferences and friends. `Frontend` is the integrated app: it now includes the original Enrolment Assistant planner alongside Better Auth account screens and the typed tRPC API. The snapshot under `Full Frontend Verion V.1` remains a standalone UI reference; run this directory for authenticated planning.

## Planner and account flow

The home route `/` checks the authenticated Better Auth session on the server and redirects signed-out visitors to `/login`. Successful sign-in opens the planner. The portal name, initials, assistant greeting and `/account` details use the session identity, never the sample user from the timetable API. Account switching remounts the planner; session checks on focus/reconnect hide stale account data. Sign-out is available from both the planner and account page.

Sign-in, signup, recovery, reset and account screens reuse the planner's Barlow fonts, grey/blue palette, square controls and blueprint borders.

Development defaults to mock mode unless `NEXT_PUBLIC_USE_MOCK=false`. Production defaults to the shared backend unless `NEXT_PUBLIC_USE_MOCK=true` is explicitly set. Mock mode keeps the original sample courses and demo planner behavior; it does not represent searchable university timetables. For a real backend, set `NEXT_PUBLIC_USE_MOCK=false`, `ENROLMENT_BACKEND_URL` to its base URL, and `TIMETABLE_BACKEND_TOKEN` to the shared service credential. The five planner operations go through protected tRPC procedures; the server forwards the session-derived user ID as `X-User-Id` and the service credential as a bearer token. The backend must verify that credential, use the user ID to scope all data and plan ownership, and implement the contract in `src/lib/enrolment-contract.ts`. Browser cookies and service credentials are not passed to client code. Allocate+ import remains unimplemented.

## Run locally

The Flask planner backend is implemented in [`../Backend`](../Backend/README.md). Follow that guide to configure DeepSeek Flash, synchronize the service token and switch off the browser mock. The server also forwards the URL-encoded session name as `X-User-Name`. Its bundled course catalogue is fictional and confirmations stay in its local database.

1. Run `npm install` in `Frontend`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL`.
3. Email verification does not gate sign-up or sign-in in any mode. Create an account at `/signup`, then sign in. Configure `AUTH_EMAIL_WEBHOOK_URL` and `AUTH_EMAIL_WEBHOOK_TOKEN` for password recovery and optional manual verification emails. The endpoint must accept a bearer-authenticated POST with JSON `{ "to": "...", "subject": "...", "text": "..." }` and return a 2xx response.
4. On a fresh PostgreSQL database, run `npm run db:deploy` and `npm run db:generate`.
5. Run `npm run dev` and open `http://localhost:3000`.

This branch preserves the original `20260907033720_init` auth migration unchanged, then adds preferences/friendships and peer requests. A database already using that migration can apply the two additions. Do not apply master's duplicate `20260928_auth_baseline` on top. If the database was created with master's migration history or with `db push`, reconcile its history before deployment. No database migrations are executed automatically.

## Saved timetables and conversations

Named timetables and their conversations are stored in PostgreSQL through authenticated `savedTimetables` tRPC procedures. Apply `20261017_saved_timetables_chat` with `npm run db:deploy`, then run `npm run db:generate` and restart the frontend. The migration adds `saved_timetable` and `timetable_library`; existing account, planner and booking records are retained.

The app automatically saves chat messages, edited rules, composer drafts, generated timetables and confirmation details. The active timetable reopens when the same account signs in on another browser. Each named timetable has its own conversation, including conversations that have not generated a plan yet. Opening a saved conversation does not replay message animations. PostgreSQL plan-family records recover a newer adjustment or confirmation if its response was not saved before the browser closed. Actual seat allocation remains the Flask planner's responsibility.

Saves are serialized and checked against a database revision. A failed save retains the page's changes and exposes Retry; a conflicting device update exposes Save a copy. Navigation and sign-out wait for a save. The browser warns before closing with unacknowledged changes. Only an acknowledged database write shows the saved status. Mock and real planner libraries are separate, but both use PostgreSQL for persistence.

On first load in a browser, the app imports any missing timetables from that account's old local-storage library. Repeated imports cannot overwrite database records. Old browser copies are retained as backups and are no longer updated. The old version did not store chat history, so historical messages cannot be recovered from those copies.

`npm test` covers persistence validation, restoration, retry ordering, conflicts, imports and account isolation using an in-memory database double. The opt-in PostgreSQL test also exercises the real Prisma queries inside a transaction that is rolled back: set `RUN_SAVED_TIMETABLE_POSTGRES_TESTS=1` and run `npx tsx --test tests/saved-timetables-postgres.test.ts` after applying the migration.

## Authentication

Better Auth stores accounts and sessions in PostgreSQL. Students sign up with an exact `@student.monash.edu` address and a 6–12 digit student ID. Staff use an exact `@monash.edu` address. Email verification is not required for sign-up, sign-in, or app access. Password reset and optional verification emails use the configurable mail webhook.

Email verification is disabled as an access requirement in development and production, regardless of planner mode. Accounts may remain `emailVerified=false`; the app checks the Monash email domain but does not prove mailbox ownership. Password recovery still needs mail delivery. Friendship and peer-data lookup follow the same eligibility policy, including unverified registered Monash accounts. `AUTH_REQUIRE_EMAIL_VERIFICATION` and `AUTH_ALLOW_UNVERIFIED_DEMO` no longer affect this policy.

The planner now uses PostgreSQL courses, alternative class times, saved student timetables and capacity-aware bookings. Prompts can identify students by name or student ID. The SQL seed creates Maya Okafor (`32000001`) and Leo Chen (`32000002`) with complete eight-class timetables. For this prototype, matching does not require sharing approval; the older peer-request endpoints remain separate. See [database setup, seed SQL and course administration](../Backend/DATABASE.md). The Prisma schema and migration include all planner tables; Flask accesses the same database through its server-only `POSTGRES_URL`.

Student IDs are unique lookup keys provided by users. The app does **not** verify an ID against Monash records or prove that an email owner owns a particular ID. Do not treat the ID alone as proof of identity.
The signup ID is locked after account creation to prevent changing the lookup identity through Better Auth's generic profile endpoint.

The `/api/auth/*` route remains available for Better Auth's optional verification and reset callbacks. The app's account forms call `/api/trpc`. Every enrolment, timetable, preference, friendship, and peer data procedure checks an authenticated Monash session server-side. The planner and `/account` page also redirect unauthenticated visitors.

## Friend requests

Open **Friends** in the navigation to send a request by Monash email, accept or decline incoming requests, cancel outgoing requests, or remove a friend. The list refreshes every 15 seconds and on window focus. Requests are delivered in the app; no invitation email is sent. Missing accounts return an error; declined requests can be sent again. Only the recipient can accept or decline.

## Peer timetable access

`peerData.lookup` finds an eligible student by exact student ID and returns only their ID and name. `peerData.request` creates a `PENDING` request. `peerData.respond` lets only that recipient choose `ACCEPTED`, `PARTIAL`, or `DENIED`. The recipient can change a decision later with `peerData.changeAccess`. The requester can withdraw with `peerData.cancel`.

`timetable.viewPeer` requires an accepted or partial grant and currently returns `{}`. Pending, denied, withdrawn, and absent requests return `FORBIDDEN`. This legacy peer-view endpoint remains a placeholder; account-owned saved timetables and conversations use `savedTimetables` instead.

`timetable.calculate` is the existing authenticated calculation mutation with no input. Set `TIMETABLE_BACKEND_URL` to its full calculation endpoint and `TIMETABLE_BACKEND_TOKEN` to a shared service token. The frontend sends a bearer-authenticated POST whose entire JSON body is `{ "userId": "<session-derived caller ID>" }`. A 2xx response becomes `{ "submitted": true }`; an unavailable or unsuccessful backend returns a tRPC error. The backend reads preferences and selected peers itself. HTTPS is required, except HTTP to localhost during development. This is separate from the interactive planner's five-operation `enrolment` API described above. Peer request screens have not been built yet.

## Checks

Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` from `Frontend`. Tests cover domain and ID validation, authentication gates, peer request ownership, placeholder access, and the backend request payload.

## tRPC and React Query

The original setup remains: `TRPCReactProvider`, `useTRPC`, `httpBatchLink`, a per-request server query client, and `createTRPCOptionsProxy`. The root layout mounts the provider. `src/trpc/hooks/auth.ts` exports `useSession()` and `useAuth()`; account forms use their typed React Query mutations. Signing in, signing out or resetting a password cancels in-flight queries and clears cached account data.

`createTRPCContext` reads the real session from request cookies, never a hardcoded or caller-supplied user ID. Protected procedures require a verified Monash account and expose `ctx.auth`, `ctx.user` and `ctx.userId`. `baseProcedure` and `createCallerFactory` remain available. Server components use `getServerCaller` or `trpc` from `src/trpc/server.tsx` for reads. Mutations must use the HTTP API so cookies reach the browser. The account page uses the server caller.

`useSession()` returns a React Query result; the safe session is in `data` (`signedIn` and `user`). `useAuth()` returns mutation objects with `mutateAsync`, `isPending` and `error`. The old direct Better Auth `signIn`/`signUp` exports have been replaced by these hooks.

## Request protection

All browser account actions go through validated tRPC procedures. Account mutations dispatch to Better Auth's HTTP handler internally so its hooks, origin checks and rate limits still run for each call, including batched calls. The generic `/api/auth/*` endpoint remains for verification/reset callbacks and applies the same identity hooks; it is not an unprotected alternative. Both create and update database hooks enforce the identity rules. Sign-out is allowed even for expired or ineligible sessions.

The tRPC route rejects foreign/opaque origins and cross-site Fetch Metadata, requires JSON for POSTs, and marks responses private/no-store. The configured `BETTER_AUTH_URL` must match the public app origin. Multiple Set-Cookie headers are forwarded separately. Client session responses never include tokens or student IDs.

Better Auth rate limiting is enabled in development and production. Its default storage is process-local memory: deployments with multiple instances need a shared rate-limit store. Configure trusted proxy/IP handling for your actual host; without a trusted client IP Better Auth uses a shared per-path bucket. Do not trust arbitrary client-supplied forwarding headers.

## Verification limits

Automated tests exercise account validation, middleware, ownership, the HTTP/batch transport, cookie forwarding and rate limiting without a live database. Database migration deployment, delivered verification/reset emails and full login against PostgreSQL require configured services. Flask supplies timetable generation and plan persistence. Live DeepSeek calls require a configured key. Partial peer timetable field filtering remains future work; `viewPeer` still returns an empty placeholder, as on master.
