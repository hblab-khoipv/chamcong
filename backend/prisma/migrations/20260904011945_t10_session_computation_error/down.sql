-- Down migration for 20260904011945_t10_session_computation_error.
-- Prisma Migrate does not generate down migrations automatically; this file
-- is hand-written and must be kept in sync with migration.sql. Applied via
-- `npm run db:migrate:down --workspace=backend` (see scripts/migrate-down.ts).

ALTER TABLE "attendance_sessions" DROP COLUMN IF EXISTS "computation_error_message";
ALTER TABLE "attendance_sessions" DROP COLUMN IF EXISTS "computation_error";
