import { AttendanceSession } from '@prisma/client'
import { prisma } from './db'
import { getSessionStaleThresholdHours } from './config'

interface SessionLockRow {
  id: string
  status: string
  logout_time: Date | null
}

// T8 item 1: LOGIN handling. If the employee already has an OPEN session
// (a missing logout from a previous shift), auto-flag it before opening the
// new one. `SELECT ... FOR UPDATE` locks that row before deciding, so a
// concurrent stale-flag sweep on the same row (T8 item 6) can't race this
// decision — see handleLogoutEvent for the symmetric, directly-tested case.
export async function handleLoginEvent(employeeId: string, eventTime: Date): Promise<AttendanceSession> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<SessionLockRow[]>`
      SELECT id, status, logout_time FROM attendance_sessions
      WHERE employee_id = ${employeeId} AND status = 'OPEN'
      ORDER BY login_time DESC
      LIMIT 1
      FOR UPDATE
    `

    if (rows.length > 0) {
      const previousOpenId = rows[0].id
      await tx.attendanceSession.update({ where: { id: previousOpenId }, data: { status: 'FLAGGED' } })
      await tx.auditLog.create({
        data: {
          action: 'session_auto_flagged_missing_logout',
          entityType: 'attendance_session',
          entityId: previousOpenId,
          before: { status: 'OPEN' },
          after: { status: 'FLAGGED', reason: 'missing logout, auto-closed by next login' },
        },
      })
    }

    const session = await tx.attendanceSession.create({
      data: { employeeId, loginTime: eventTime, status: 'OPEN' },
    })
    await tx.auditLog.create({
      data: {
        action: 'session_opened',
        entityType: 'attendance_session',
        entityId: session.id,
        after: { status: 'OPEN', loginTime: eventTime.toISOString() },
      },
    })
    return session
  })
}

// T8 items 2 & 6: LOGOUT handling. Closes the employee's most recent
// session if it's still OPEN, or creates an orphan FLAGGED session
// (login_time=null) when there truly is none in progress.
//
// `SELECT ... FOR UPDATE` locks that specific row (whichever it is) before
// deciding, so a concurrent stale-flag sweep transaction on the same
// session can't interleave with this decision: Postgres serializes the two
// transactions on the row lock, and whichever commits first is what the
// other sees when it re-reads the row after acquiring the lock. Without
// this, a plain `WHERE status = 'OPEN'` re-query after losing a race would
// find nothing and wrongly conclude "no session at all", creating a
// duplicate orphan session for the same shift the sweep just flagged.
export async function handleLogoutEvent(employeeId: string, eventTime: Date): Promise<AttendanceSession> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<SessionLockRow[]>`
      SELECT id, status, logout_time FROM attendance_sessions
      WHERE employee_id = ${employeeId}
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `
    const mostRecent = rows[0]

    if (mostRecent && mostRecent.status === 'OPEN') {
      await tx.attendanceSession.update({
        where: { id: mostRecent.id },
        data: { status: 'CLOSED', logoutTime: eventTime },
      })
      await tx.auditLog.create({
        data: {
          action: 'session_closed',
          entityType: 'attendance_session',
          entityId: mostRecent.id,
          before: { status: 'OPEN' },
          after: { status: 'CLOSED', logoutTime: eventTime.toISOString() },
        },
      })
      return tx.attendanceSession.findUniqueOrThrow({ where: { id: mostRecent.id } })
    }

    if (mostRecent && mostRecent.logout_time === null) {
      // Most recent session is already unresolved-but-not-OPEN — it just
      // won this exact race against us (e.g. the stale-flag sweep got
      // there first). That transition already stands; report its current
      // state instead of spawning a duplicate for the same shift.
      return tx.attendanceSession.findUniqueOrThrow({ where: { id: mostRecent.id } })
    }

    const session = await tx.attendanceSession.create({
      data: { employeeId, loginTime: null, logoutTime: eventTime, status: 'FLAGGED' },
    })
    await tx.auditLog.create({
      data: {
        action: 'session_orphan_logout_flagged',
        entityType: 'attendance_session',
        entityId: session.id,
        after: { status: 'FLAGGED', logoutTime: eventTime.toISOString(), reason: 'logout with no open login session' },
      },
    })
    return session
  })
}

// T8 item 3: periodic sweep — flags OPEN sessions that have been open
// longer than the configured threshold (default 16h). Scheduled hourly from
// src/index.ts; exported standalone so tests can invoke it directly. Each
// candidate is re-checked and flagged inside its own `SELECT ... FOR
// UPDATE` transaction so it can't race a concurrent LOGOUT closing the same
// session (T8 item 6).
export async function flagStaleOpenSessions(now: Date = new Date()): Promise<number> {
  const thresholdHours = getSessionStaleThresholdHours()
  const cutoff = new Date(now.getTime() - thresholdHours * 60 * 60 * 1000)

  const candidates = await prisma.attendanceSession.findMany({
    where: { status: 'OPEN', loginTime: { lt: cutoff } },
    select: { id: true },
  })

  let flaggedCount = 0
  for (const { id } of candidates) {
    const flagged = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status FROM attendance_sessions WHERE id = ${id} FOR UPDATE
      `
      if (rows.length === 0 || rows[0].status !== 'OPEN') {
        return false
      }
      await tx.attendanceSession.update({ where: { id }, data: { status: 'FLAGGED' } })
      await tx.auditLog.create({
        data: {
          action: 'session_auto_flagged_stale',
          entityType: 'attendance_session',
          entityId: id,
          before: { status: 'OPEN' },
          after: { status: 'FLAGGED', reason: `open longer than ${thresholdHours}h threshold` },
        },
      })
      return true
    })
    if (flagged) flaggedCount += 1
  }
  return flaggedCount
}
