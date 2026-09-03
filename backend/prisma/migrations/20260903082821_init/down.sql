-- Down migration for 20260903082821_init.
-- Prisma Migrate does not generate down migrations automatically; this file
-- is hand-written and must be kept in sync with migration.sql. Applied via
-- `npm run db:migrate:down --workspace=backend` (see scripts/migrate-down.ts).

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_admin_id_fkey";
ALTER TABLE "attendance_session_segments" DROP CONSTRAINT IF EXISTS "attendance_session_segments_holiday_id_fkey";
ALTER TABLE "attendance_session_segments" DROP CONSTRAINT IF EXISTS "attendance_session_segments_rate_band_id_fkey";
ALTER TABLE "attendance_session_segments" DROP CONSTRAINT IF EXISTS "attendance_session_segments_session_id_fkey";
ALTER TABLE "attendance_sessions" DROP CONSTRAINT IF EXISTS "attendance_sessions_employee_id_fkey";
ALTER TABLE "attendance_events" DROP CONSTRAINT IF EXISTS "attendance_events_employee_id_fkey";

-- DropTable
DROP TABLE IF EXISTS "webhook_logs";
DROP TABLE IF EXISTS "audit_logs";
DROP TABLE IF EXISTS "attendance_session_segments";
DROP TABLE IF EXISTS "attendance_sessions";
DROP TABLE IF EXISTS "attendance_events";
DROP TABLE IF EXISTS "holidays";
DROP TABLE IF EXISTS "rate_bands";
DROP TABLE IF EXISTS "employees";
DROP TABLE IF EXISTS "admins";

-- DropEnum
DROP TYPE IF EXISTS "HolidayRateType";
DROP TYPE IF EXISTS "AttendanceSessionStatus";
DROP TYPE IF EXISTS "AttendanceEventProcessStatus";
DROP TYPE IF EXISTS "AttendanceEventType";
DROP TYPE IF EXISTS "EmployeeSource";
