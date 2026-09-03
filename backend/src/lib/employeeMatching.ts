import { AttendanceEvent, Employee, Prisma } from '@prisma/client'
import { prisma } from './db'
import { isAutoCreateEmployeeOnWebhookEnabled } from './config'

export type EmployeeMatchResult = { matched: true; employee: Employee } | { matched: false }

// T7 items 1-2: match attendance_event.employee_external_id to an existing
// Employee, or auto-create a source=synced one when
// AUTO_CREATE_EMPLOYEE_ON_WEBHOOK is enabled (default true).
export async function resolveEmployeeForEvent(
  event: Pick<AttendanceEvent, 'employeeExternalId' | 'rawPayload'>
): Promise<EmployeeMatchResult> {
  const existing = await prisma.employee.findUnique({ where: { externalId: event.employeeExternalId } })
  if (existing) {
    return { matched: true, employee: existing }
  }

  if (!isAutoCreateEmployeeOnWebhookEnabled()) {
    return { matched: false }
  }

  const payload = event.rawPayload as Record<string, unknown> | null
  const name =
    typeof payload?.employee_name === 'string' && payload.employee_name.trim()
      ? payload.employee_name.trim()
      : event.employeeExternalId

  try {
    const employee = await prisma.employee.create({
      data: { externalId: event.employeeExternalId, name, source: 'synced', active: true },
    })
    return { matched: true, employee }
  } catch (err) {
    // Two events for the same brand-new external_id racing each other: the
    // loser hits the unique constraint on external_id, not a real failure —
    // fetch the winner's row instead.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const employee = await prisma.employee.findUnique({ where: { externalId: event.employeeExternalId } })
      if (employee) return { matched: true, employee }
    }
    throw err
  }
}
