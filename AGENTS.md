# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Stack & structure

npm workspaces (`backend`, `frontend`), TypeScript throughout. Backend:
Express + Prisma + PostgreSQL. Frontend: React + Vite. Tech choices and repo
layout rationale are in `README.md`; task breakdown and full spec (data
model, per-task scope/acceptance criteria) is `PRD/PRD_ChamCong_TaskBreakdown.md`
— treat it as authoritative before adding any new endpoint or table.

## Backend tests need a real Postgres

`backend/vitest.config.ts` runs `prisma migrate deploy` once via
`globalSetup` before the suite, then integration tests hit that DB directly
(see `backend/src/tests/testUtils/db.ts` for the between-test truncation
helper). There is no in-memory/mocked DB path for these tests — set
`DATABASE_URL` (in `backend/.env`, gitignored) to a real Postgres before
running `npm test --workspace=backend`. CI provisions this via a `postgres`
service container in `.github/workflows/ci.yml`'s `test-backend` job.

## Migrations: Prisma has no built-in down migration

Each migration folder under `backend/prisma/migrations/` needs a
hand-written `down.sql` alongside Prisma's generated `migration.sql` — keep
them in sync manually when editing `schema.prisma`. Apply a down migration
with `npm run db:migrate:down --workspace=backend` (`backend/scripts/migrate-down.ts`),
which also deletes the migration's `_prisma_migrations` row so
`prisma migrate deploy` can re-apply it cleanly afterward. It reverts
*one* migration at a time (defaulting to the newest); `src/tests/
migration.test.ts`'s full up/down cycle test reverts every migration folder
individually in reverse order to tear the schema all the way down — update
that loop, not a single `migrate-down.ts` call, if a full-teardown test ever
needs to change.

## Rate band time-of-day convention

`rate_bands.start_time`/`end_time` are Postgres `TIME` (date-less). Convention:
when `end_time <= start_time`, the band wraps past midnight and ends on the
next calendar day (e.g. `17:00–00:00` means 17:00 today through 24:00 today).
This exists because `TIME` can't represent a literal `24:00`. Full detail and
the seeded default 3-band layout: `docs/ERD.md`.

## Rate band overlap/gap math

Overlap validation and the `GET /rate-bands/coverage` gap check both go
through `backend/src/lib/timeOfDay.ts`: each band is converted to minutes-
since-midnight and split into 1-2 half-open intervals on a fixed 0-1440
line (`bandIntervals`, applying the midnight-wrap convention above), then
compared/merged. Add new band-schedule logic there rather than
re-deriving interval math in a route handler.

## Soft-delete semantics differ between rate_bands and holidays

`DELETE /rate-bands/:id` hard-deletes unless a segment references it (then
soft-deletes). `DELETE /holidays/:id` always soft-deletes (deactivates) —
the PRD treats holiday delete/deactivate as the same operation, so there is
no hard-delete path for holidays. Don't assume the two DELETE endpoints
behave the same way.

## Rate splitting engine (T9) and its DB wiring (T10/T11)

`backend/src/lib/rateSplitting.ts#splitSessionIntoSegments` is the whole
money-calculation algorithm as a pure function (`(login_time, logout_time,
active rate bands, active holidays) -> segments[]`, no DB access, no
Date.now()) — split at VN-midnight boundaries first, then rate-band
boundaries within each day, then holiday rate within each resulting
segment; an uncovered minute becomes a `rate_band_id=null`/`rate_applied=0`
segment plus a warning rather than being dropped. It owns the PERCENT/FIXED
arithmetic (`applyHolidayRateToBase`); `lib/holidayRate.ts#applyHolidayRate`
(T5) delegates to it so the two never drift apart. `lib/timeOfDay.ts`'s
`vnMinutesOfDay`/`vnCalendarDayLabel`/`vnDayStartInstant` bridge UTC-stored
`login_time`/`logout_time` instants to VN wall-clock minutes/calendar days
(VN is fixed UTC+7, no DST) — `vnCalendarDayLabel`'s output is deliberately
the same date-only-UTC-instant shape as `holidays.holiday_date`, so the two
compare with a plain `getTime()`.

`backend/src/lib/sessionRateEngine.ts#recomputeSessionSegments` is the one
DB-wiring entry point that (re)runs the engine against *currently* active
rate bands/holidays and overwrites a session's segments, snapshotting
`rate_applied_vnd`/`amount_vnd` at write time — later config edits never
touch already-computed sessions. It's reused by three callers: `lib/
attendanceSession.ts#handleLogoutEvent` (T10, fires the moment a session
transitions to CLOSED), and the T11 routes below. Any failure (e.g. a rate
band deleted between reading the active-config snapshot and writing
segments — the FK on `attendance_session_segments.rate_band_id`) is caught
and recorded as `attendance_sessions.computation_error`/
`computation_error_message` instead of throwing; the session keeps
whatever status it already had. `fetchActiveRateConfig` and
`persistSegmentsOrFlagError` are exported separately from
`recomputeSessionSegments` specifically so this race can be tested
deterministically (read config, mutate the DB out from under it, then
persist) instead of relying on real concurrency timing.

`PATCH /attendance-sessions/:id` (T11) edits `login_time`/`logout_time`
(required to fill in a FLAGGED session's missing side), sets
`status=MANUAL` on success only when the edit leaves both `login_time`
and `logout_time` non-null (the chosen convention for "hand-corrected" —
a partial edit that still leaves one side null, e.g. fixing `login_time`
on a still-OPEN session, leaves status unchanged so the session stays in
the OPEN/FLAGGED lifecycle `attendanceSession.ts` keys off of), rejects
`logout_time <= login_time` and overlaps with another session for
the same employee, then calls `recomputeSessionSegments`. `POST
/attendance-sessions/:id/recompute` re-runs it against current config on
demand and requires `{ confirm: true }` in the body (400 otherwise) since it
can silently change historical totals. Both audit-log
before/after + `admin.id` via the standard `audit_logs` table — query it
directly (as existing tests do) rather than via a dedicated endpoint; none
exists.

## Router mount order in app.ts matters

Every router in `backend/src/app.ts` is mounted with `app.use(router)` (no
path prefix) and each protected router calls `router.use(authenticate)`
unconditionally — so a router mounted earlier intercepts *every* request
path, not just its own, and 401s before Express ever reaches a later
router. Any new unauthenticated route (like `POST /webhooks/attendance`,
T6) must be mounted before all `authenticate`-guarded routers, not just in
whatever position feels natural.

## Attendance webhook → session pipeline (T6-T8)

`POST /webhooks/attendance` (`backend/src/routes/webhooks.ts`, no auth —
`verifyWebhookAuth()` in `lib/webhookAuth.ts` is a T17 placeholder) does
idempotent intake (`dedupe_key`) into `attendance_events`, then calls
`lib/attendanceProcessing.ts#processAttendanceEvent` synchronously before
responding — no queue. That function chains `lib/employeeMatching.ts`
(T7: match/auto-create by `external_id`, else `UNMATCHED`) and
`lib/attendanceSession.ts` (T8: LOGIN/LOGOUT pairing, orphan/missing-logout
FLAGGED sessions, hourly stale-session sweep). The same
`processAttendanceEvent` path is reused by `POST
/attendance-events/:id/reprocess`, so a manually-linked employee replays
through identical logic. `AUTO_CREATE_EMPLOYEE_ON_WEBHOOK` and
`ATTENDANCE_SESSION_STALE_HOURS` (`lib/config.ts`) are plain env vars, not
a Settings entity/UI — that doesn't exist until T14 (Phase 5).

## Session state transitions use SELECT ... FOR UPDATE, not read-then-write

`lib/attendanceSession.ts`'s LOGIN/LOGOUT handlers and the stale-flag sweep
each wrap their session read+write in `prisma.$transaction`, locking the
target row with a raw `SELECT ... FOR UPDATE` before deciding what to do,
then writing through `tx.attendanceSession.update(...)`. This is what makes
the LOGOUT-vs-stale-sweep race (T8) safe: two concurrent transactions
touching the same row serialize on the row lock, so whichever commits
first is what the other sees when it re-reads the row after acquiring the
lock — the loser reacts to the winner's outcome instead of overwriting it.
LOGIN/LOGOUT additionally take a per-employee `pg_advisory_xact_lock`
before the row lock, since a brand-new employee has no existing row to
lock two concurrent first-ever LOGINs against.

## Auth model

JWT is stateless (no server-side session/blacklist) — `POST /auth/logout` is
a formality endpoint. "Old credentials stop working" is enforced by password
change, not token revocation. Login rate limiting
(`backend/src/middleware/loginRateLimit.ts`) is an in-memory per-process Map,
fine for this app's single-instance deployment target; would need a shared
store if ever run behind multiple instances.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
