-- CreateEnum
CREATE TYPE "EmployeeSource" AS ENUM ('synced', 'manual');

-- CreateEnum
CREATE TYPE "AttendanceEventType" AS ENUM ('LOGIN', 'LOGOUT');

-- CreateEnum
CREATE TYPE "AttendanceEventProcessStatus" AS ENUM ('PENDING', 'PROCESSED', 'UNMATCHED', 'ERROR');

-- CreateEnum
CREATE TYPE "AttendanceSessionStatus" AS ENUM ('OPEN', 'CLOSED', 'FLAGGED', 'MANUAL');

-- CreateEnum
CREATE TYPE "HolidayRateType" AS ENUM ('PERCENT', 'FIXED');

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "external_id" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "source" "EmployeeSource" NOT NULL DEFAULT 'manual',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_bands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "rate_per_hour_vnd" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_bands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "holiday_date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "rate_type" "HolidayRateType" NOT NULL,
    "rate_value" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_events" (
    "id" TEXT NOT NULL,
    "employee_external_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "event_type" "AttendanceEventType" NOT NULL,
    "event_time" TIMESTAMP(3) NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "process_status" "AttendanceEventProcessStatus" NOT NULL DEFAULT 'PENDING',
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "login_time" TIMESTAMP(3),
    "logout_time" TIMESTAMP(3),
    "status" "AttendanceSessionStatus" NOT NULL DEFAULT 'OPEN',
    "total_hours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_amount_vnd" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_session_segments" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "rate_band_id" TEXT,
    "holiday_id" TEXT,
    "segment_start" TIMESTAMP(3) NOT NULL,
    "segment_end" TIMESTAMP(3) NOT NULL,
    "hours" DECIMAL(10,2) NOT NULL,
    "rate_applied_vnd" INTEGER NOT NULL,
    "amount_vnd" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_session_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_logs" (
    "id" TEXT NOT NULL,
    "raw_body" JSONB,
    "headers" JSONB,
    "result_status" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "employees_external_id_key" ON "employees"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_holiday_date_key" ON "holidays"("holiday_date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_events_dedupe_key_key" ON "attendance_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "attendance_events_employee_id_idx" ON "attendance_events"("employee_id");

-- CreateIndex
CREATE INDEX "attendance_events_event_time_idx" ON "attendance_events"("event_time");

-- CreateIndex
CREATE INDEX "attendance_sessions_employee_id_idx" ON "attendance_sessions"("employee_id");

-- CreateIndex
CREATE INDEX "attendance_sessions_employee_id_status_idx" ON "attendance_sessions"("employee_id", "status");

-- CreateIndex
CREATE INDEX "attendance_session_segments_session_id_idx" ON "attendance_session_segments"("session_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_session_segments" ADD CONSTRAINT "attendance_session_segments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "attendance_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_session_segments" ADD CONSTRAINT "attendance_session_segments_rate_band_id_fkey" FOREIGN KEY ("rate_band_id") REFERENCES "rate_bands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_session_segments" ADD CONSTRAINT "attendance_session_segments_holiday_id_fkey" FOREIGN KEY ("holiday_id") REFERENCES "holidays"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
