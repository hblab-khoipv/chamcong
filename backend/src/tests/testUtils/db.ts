import { prisma } from '../../lib/db'

// Deletes rows in FK-safe order (children before parents). Used between
// integration tests to isolate them from one another.
export async function resetDb(): Promise<void> {
  await prisma.attendanceSessionSegment.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.attendanceEvent.deleteMany()
  await prisma.attendanceSession.deleteMany()
  await prisma.webhookLog.deleteMany()
  await prisma.employee.deleteMany()
  await prisma.holiday.deleteMany()
  await prisma.rateBand.deleteMany()
  await prisma.admin.deleteMany()
}
