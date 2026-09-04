-- AlterTable
ALTER TABLE "attendance_sessions" ADD COLUMN     "computation_error" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "computation_error_message" TEXT;
