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
`prisma migrate deploy` can re-apply it cleanly afterward.

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

## Holiday rate calc is a standalone stub until T9

`backend/src/lib/holidayRate.ts` has `getActiveHolidayForDate` (the
internal "check if a date is a holiday" lookup the PRD describes for T5
item 6) and `applyHolidayRate` (pure PERCENT/FIXED arithmetic). Neither is
wired into `attendance_sessions`/`attendance_session_segments` yet — that
integration is T9's rate splitting engine. T9 should call these rather than
reimplementing the PERCENT/FIXED math.

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
