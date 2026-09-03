import { prisma } from './db'
import { resolveEmployeeForEvent } from './employeeMatching'
import { handleLoginEvent, handleLogoutEvent } from './attendanceSession'

// Ties T7 (employee matching) and T8 (session lifecycle) together for one
// attendance_event. Called synchronously from the webhook request (T6 item
// 5) and from the manual reprocess endpoint (T7 item 5) — same code path so
// a reprocessed UNMATCHED event goes through identical matching+session
// logic as a fresh webhook.
export async function processAttendanceEvent(eventId: string): Promise<void> {
  const event = await prisma.attendanceEvent.findUnique({ where: { id: eventId } })
  if (!event) return

  try {
    const match = await resolveEmployeeForEvent(event)

    if (!match.matched) {
      await prisma.attendanceEvent.update({
        where: { id: event.id },
        data: { processStatus: 'UNMATCHED' },
      })
      return
    }

    const { employee } = match

    // T7 test case: an inactive employee's events are still recorded, with
    // a warning for Admin to act on manually (default business decision —
    // see PRD T7 acceptance criteria item 4).
    if (!employee.active) {
      await prisma.auditLog.create({
        data: {
          action: 'attendance_event_inactive_employee_warning',
          entityType: 'attendance_event',
          entityId: event.id,
          after: { employeeId: employee.id, warning: 'employee is inactive; event recorded anyway per T7 default' },
        },
      })
    }

    if (event.eventType === 'LOGIN') {
      await handleLoginEvent(employee.id, event.eventTime)
    } else {
      await handleLogoutEvent(employee.id, event.eventTime)
    }

    await prisma.attendanceEvent.update({
      where: { id: event.id },
      data: { processStatus: 'PROCESSED', employeeId: employee.id },
    })
  } catch (err) {
    console.error(`[chamcong] failed to process attendance_event ${event.id}:`, err)
    await prisma.attendanceEvent
      .update({ where: { id: event.id }, data: { processStatus: 'ERROR' } })
      .catch(() => {})
  }
}
