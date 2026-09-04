import { AttendanceSession, AttendanceSessionStatus, Prisma } from '@prisma/client'
import { Response, Router } from 'express'
import { AuthenticatedRequest, authenticate } from '../middleware/authenticate'
import { prisma } from '../lib/db'

const router = Router()

router.use(authenticate)

const VALID_STATUSES = new Set<AttendanceSessionStatus>(['OPEN', 'CLOSED', 'FLAGGED', 'MANUAL'])

function serialize(session: AttendanceSession) {
  return {
    id: session.id,
    employeeId: session.employeeId,
    loginTime: session.loginTime,
    logoutTime: session.logoutTime,
    status: session.status,
    totalHours: Number(session.totalHours),
    totalAmountVnd: session.totalAmountVnd,
    computedAt: session.computedAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

// T8 item 5: e.g. GET /attendance-sessions?status=FLAGGED — sessions Admin
// needs to handle manually (missing login/logout, or auto-flagged stale).
router.get('/attendance-sessions', async (req: AuthenticatedRequest, res: Response) => {
  const { status, employeeId } = req.query

  const where: Prisma.AttendanceSessionWhereInput = {}
  if (typeof status === 'string' && VALID_STATUSES.has(status as AttendanceSessionStatus)) {
    where.status = status as AttendanceSessionStatus
  }
  if (typeof employeeId === 'string' && employeeId.trim()) {
    where.employeeId = employeeId.trim()
  }

  const sessions = await prisma.attendanceSession.findMany({ where, orderBy: { createdAt: 'desc' } })
  res.status(200).json({ attendanceSessions: sessions.map(serialize) })
})

export default router
