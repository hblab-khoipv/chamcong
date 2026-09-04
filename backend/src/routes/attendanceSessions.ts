import { AttendanceSession, AttendanceSessionStatus, Prisma } from '@prisma/client'
import { Response, Router } from 'express'
import { AuthenticatedRequest, authenticate } from '../middleware/authenticate'
import { prisma } from '../lib/db'
import { recomputeSessionSegments } from '../lib/sessionRateEngine'

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
    computationError: session.computationError,
    computationErrorMessage: session.computationErrorMessage,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

async function serializeWithSegments(session: AttendanceSession) {
  const segments = await prisma.attendanceSessionSegment.findMany({
    where: { sessionId: session.id },
    orderBy: { segmentStart: 'asc' },
  })
  return {
    ...serialize(session),
    segments: segments.map((s) => ({
      id: s.id,
      rateBandId: s.rateBandId,
      holidayId: s.holidayId,
      segmentStart: s.segmentStart,
      segmentEnd: s.segmentEnd,
      hours: Number(s.hours),
      rateAppliedVnd: s.rateAppliedVnd,
      amountVnd: s.amountVnd,
    })),
  }
}

// Half-open interval overlap: a session with no logout_time yet (OPEN) is
// treated as extending indefinitely into the future for this check, and a
// logout-only orphan (login_time still null) is treated as extending
// indefinitely into the past.
const FAR_FUTURE = new Date(8_640_000_000_000_000)
const FAR_PAST = new Date(-8_640_000_000_000_000)

async function findOverlappingSession(
  employeeId: string,
  loginTime: Date,
  logoutTime: Date,
  excludeId: string
): Promise<AttendanceSession | null> {
  const candidates = await prisma.attendanceSession.findMany({
    where: {
      employeeId,
      id: { not: excludeId },
      OR: [{ loginTime: { not: null } }, { logoutTime: { not: null } }],
    },
  })
  return (
    candidates.find((s) => {
      const otherStart = s.loginTime ?? FAR_PAST
      const otherEnd = s.logoutTime ?? FAR_FUTURE
      return loginTime < otherEnd && otherStart < logoutTime
    }) ?? null
  )
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

// T15 item 2: read-only session detail with its segment-by-segment pay
// breakdown, for the Admin UI's "view session" screen. Unlike the PATCH and
// POST .../recompute handlers below -- the only other places segments are
// serialized -- this never mutates the session.
router.get('/attendance-sessions/:id', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params
  const session = await prisma.attendanceSession.findUnique({ where: { id } })
  if (!session) {
    res.status(404).json({ error: 'Attendance session not found' })
    return
  }
  res.status(200).json({ attendanceSession: await serializeWithSegments(session) })
})

// T11 item 1: Admin edits login_time/logout_time (required to fill in a
// FLAGGED session's missing side). A successful edit that leaves both
// login_time and logout_time populated marks the session MANUAL — the
// chosen convention (documented per T11 acceptance criteria's "MANUAL
// hoặc CLOSED tuỳ quy ước đã chọn") for "this session's times were
// hand-corrected". An edit that still leaves one side null (e.g. fixing
// login_time on a still-OPEN session) leaves status unchanged so the
// session stays in the OPEN/FLAGGED lifecycle T8 keys off of.
router.patch('/attendance-sessions/:id', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params
  const existing = await prisma.attendanceSession.findUnique({ where: { id } })
  if (!existing) {
    res.status(404).json({ error: 'Attendance session not found' })
    return
  }

  const { login_time: loginTimeRaw, logout_time: logoutTimeRaw } = req.body ?? {}

  if (loginTimeRaw === undefined && logoutTimeRaw === undefined) {
    res.status(400).json({ error: 'login_time or logout_time is required' })
    return
  }

  let loginTime = existing.loginTime
  if (loginTimeRaw !== undefined) {
    const parsed = new Date(loginTimeRaw)
    if (typeof loginTimeRaw !== 'string' || Number.isNaN(parsed.getTime())) {
      res.status(400).json({ error: 'login_time must be a valid ISO timestamp' })
      return
    }
    loginTime = parsed
  }

  let logoutTime = existing.logoutTime
  if (logoutTimeRaw !== undefined) {
    const parsed = new Date(logoutTimeRaw)
    if (typeof logoutTimeRaw !== 'string' || Number.isNaN(parsed.getTime())) {
      res.status(400).json({ error: 'logout_time must be a valid ISO timestamp' })
      return
    }
    logoutTime = parsed
  }

  if (loginTime && logoutTime && logoutTime <= loginTime) {
    res.status(400).json({ error: 'logout_time must be after login_time' })
    return
  }

  if (loginTime && logoutTime) {
    const conflict = await findOverlappingSession(existing.employeeId, loginTime, logoutTime, id)
    if (conflict) {
      res.status(409).json({ error: `Overlaps with another session (${conflict.id}) for this employee` })
      return
    }
  }

  const before = { loginTime: existing.loginTime, logoutTime: existing.logoutTime, status: existing.status }

  await prisma.attendanceSession.update({
    where: { id },
    data: { loginTime, logoutTime, ...(loginTime && logoutTime ? { status: 'MANUAL' as const } : {}) },
  })
  // T11 item 2: re-trigger T9, overwriting the previous segments.
  const updated = await recomputeSessionSegments(id)

  await prisma.auditLog.create({
    data: {
      adminId: req.admin?.id ?? null,
      action: 'session_manual_correction',
      entityType: 'attendance_session',
      entityId: id,
      before,
      after: { loginTime: updated.loginTime, logoutTime: updated.logoutTime, status: updated.status },
    },
  })

  res.status(200).json({ attendanceSession: await serializeWithSegments(updated) })
})

// T11 item 3: deliberately recompute a session against *current* rate/
// holiday config, overwriting historical numbers -- requires an explicit
// confirm flag since it can change figures Admin already reported on.
router.post('/attendance-sessions/:id/recompute', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params
  const existing = await prisma.attendanceSession.findUnique({ where: { id } })
  if (!existing) {
    res.status(404).json({ error: 'Attendance session not found' })
    return
  }

  if (req.body?.confirm !== true) {
    res.status(400).json({
      error: 'Recomputing overwrites this session\'s historical totals with current rate/holiday config. Resend with { "confirm": true } to proceed.',
    })
    return
  }

  if (!existing.loginTime || !existing.logoutTime) {
    res.status(400).json({ error: 'Cannot recompute a session that is missing login_time or logout_time' })
    return
  }

  const before = { totalHours: Number(existing.totalHours), totalAmountVnd: existing.totalAmountVnd }
  const updated = await recomputeSessionSegments(id)

  await prisma.auditLog.create({
    data: {
      adminId: req.admin?.id ?? null,
      action: 'session_recompute',
      entityType: 'attendance_session',
      entityId: id,
      before,
      after: { totalHours: Number(updated.totalHours), totalAmountVnd: updated.totalAmountVnd },
    },
  })

  res.status(200).json({ attendanceSession: await serializeWithSegments(updated) })
})

export default router
