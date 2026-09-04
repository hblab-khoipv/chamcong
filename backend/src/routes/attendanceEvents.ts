import { AttendanceEvent } from '@prisma/client'
import { Response, Router } from 'express'
import { AuthenticatedRequest, authenticate } from '../middleware/authenticate'
import { prisma } from '../lib/db'
import { processAttendanceEvent } from '../lib/attendanceProcessing'

const router = Router()

router.use(authenticate)

function serialize(event: AttendanceEvent) {
  return {
    id: event.id,
    employeeExternalId: event.employeeExternalId,
    employeeId: event.employeeId,
    eventType: event.eventType,
    eventTime: event.eventTime,
    processStatus: event.processStatus,
    receivedAt: event.receivedAt,
  }
}

// T7 item 4: events that couldn't be matched to an employee (auto-create
// disabled) — Admin works through this list to link/create employees.
router.get('/attendance-events/unmatched', async (_req: AuthenticatedRequest, res: Response) => {
  const events = await prisma.attendanceEvent.findMany({
    where: { processStatus: 'UNMATCHED' },
    orderBy: { eventTime: 'asc' },
  })
  res.status(200).json({ attendanceEvents: events.map(serialize) })
})

// T7 item 5: reprocess one event after Admin has linked its external_id
// (via PATCH /employees/:id/link-external) to an employee.
router.post('/attendance-events/:id/reprocess', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params

  const existing = await prisma.attendanceEvent.findUnique({ where: { id } })
  if (!existing) {
    res.status(404).json({ error: 'Attendance event not found' })
    return
  }

  await processAttendanceEvent(id)

  const updated = await prisma.attendanceEvent.findUniqueOrThrow({ where: { id } })
  res.status(200).json({ attendanceEvent: serialize(updated) })
})

export default router
