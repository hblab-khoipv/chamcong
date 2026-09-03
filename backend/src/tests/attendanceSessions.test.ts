import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { prisma } from '../lib/db'
import { flagStaleOpenSessions } from '../lib/attendanceSession'
import { resetDb } from './testUtils/db'

const app = createApp()

function validPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    employee_external_id: 'EMP001',
    employee_name: 'Nguyen Van A',
    event_type: 'LOGIN',
    event_time: '2026-08-30T09:02:15+07:00',
    event_id: 'evt_abc123',
    ...overrides,
  }
}

function webhook(payload: Record<string, unknown>): request.Test {
  return request(app).post('/webhooks/attendance').send(payload)
}

describe('T8 attendance session lifecycle', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await resetDb()
  })

  // T8 test case: "LOGIN rồi LOGOUT cùng ngày -> session CLOSED, giờ đúng."
  it('LOGIN then LOGOUT the same day closes the session with the correct times', async () => {
    const employee = await prisma.employee.create({
      data: { externalId: 'EMP_NORMAL', name: 'Normal Guy', source: 'manual' },
    })

    await webhook(
      validPayload({
        employee_external_id: 'EMP_NORMAL',
        event_type: 'LOGIN',
        event_time: '2026-08-30T09:00:00+07:00',
        event_id: 'evt_n_1',
      })
    )
    await webhook(
      validPayload({
        employee_external_id: 'EMP_NORMAL',
        event_type: 'LOGOUT',
        event_time: '2026-08-30T17:00:00+07:00',
        event_id: 'evt_n_2',
      })
    )

    const session = await prisma.attendanceSession.findFirstOrThrow({ where: { employeeId: employee.id } })
    expect(session.status).toBe('CLOSED')
    expect(session.loginTime?.toISOString()).toBe(new Date('2026-08-30T09:00:00+07:00').toISOString())
    expect(session.logoutTime?.toISOString()).toBe(new Date('2026-08-30T17:00:00+07:00').toISOString())
  })

  // T8 test case: "LOGIN, LOGIN (employee quên logout) -> session 1 chuyển
  // FLAGGED, session 2 là OPEN mới."
  it('a second LOGIN without a prior LOGOUT flags the old session and opens a new OPEN one', async () => {
    const employee = await prisma.employee.create({
      data: { externalId: 'EMP_DOUBLE_LOGIN', name: 'Forgetful', source: 'manual' },
    })

    await webhook(
      validPayload({
        employee_external_id: 'EMP_DOUBLE_LOGIN',
        event_type: 'LOGIN',
        event_time: '2026-08-30T08:00:00+07:00',
        event_id: 'evt_dl_1',
      })
    )
    await webhook(
      validPayload({
        employee_external_id: 'EMP_DOUBLE_LOGIN',
        event_type: 'LOGIN',
        event_time: '2026-08-30T20:00:00+07:00',
        event_id: 'evt_dl_2',
      })
    )

    const sessions = await prisma.attendanceSession.findMany({
      where: { employeeId: employee.id },
      orderBy: { loginTime: 'asc' },
    })
    expect(sessions).toHaveLength(2)
    expect(sessions[0].status).toBe('FLAGGED')
    expect(sessions[1].status).toBe('OPEN')
  })

  // T8 test case: "LOGOUT không có LOGIN trước -> tạo session FLAGGED,
  // login_time=null, không tính tiền cho tới khi Admin bổ sung."
  it('a LOGOUT with no open LOGIN creates a FLAGGED session with login_time=null', async () => {
    const employee = await prisma.employee.create({
      data: { externalId: 'EMP_ORPHAN', name: 'Orphan Guy', source: 'manual' },
    })

    const res = await webhook(
      validPayload({
        employee_external_id: 'EMP_ORPHAN',
        event_type: 'LOGOUT',
        event_time: '2026-08-30T17:00:00+07:00',
        event_id: 'evt_orphan_1',
      })
    )
    expect(res.status).toBe(200)

    const session = await prisma.attendanceSession.findFirstOrThrow({ where: { employeeId: employee.id } })
    expect(session.status).toBe('FLAGGED')
    expect(session.loginTime).toBeNull()
    expect(session.logoutTime?.toISOString()).toBe(new Date('2026-08-30T17:00:00+07:00').toISOString())
  })

  // T8 test case: "Session OPEN từ 20 giờ trước (giả lập bằng cách chỉnh
  // login_time trong test), chạy job quét -> session chuyển FLAGGED."
  it('flags a session open past the stale threshold when the sweep job runs', async () => {
    const employee = await prisma.employee.create({
      data: { externalId: 'EMP_STALE', name: 'Stale Guy', source: 'manual' },
    })
    const twentyHoursAgo = new Date(Date.now() - 20 * 60 * 60 * 1000)

    await webhook(
      validPayload({
        employee_external_id: 'EMP_STALE',
        event_type: 'LOGIN',
        event_time: twentyHoursAgo.toISOString(),
        event_id: 'evt_stale_login',
      })
    )

    const openSession = await prisma.attendanceSession.findFirstOrThrow({ where: { employeeId: employee.id } })
    expect(openSession.status).toBe('OPEN')

    const flaggedCount = await flagStaleOpenSessions()
    expect(flaggedCount).toBeGreaterThanOrEqual(1)

    const updated = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: openSession.id } })
    expect(updated.status).toBe('FLAGGED')
  })

  // T8 test case: "Hai nhân viên khác nhau login/logout xen kẽ nhau -> mỗi
  // người có session riêng, không lẫn lộn."
  it('two employees logging in/out interleaved get separate, non-mixed sessions', async () => {
    const empA = await prisma.employee.create({ data: { externalId: 'EMP_A', name: 'A', source: 'manual' } })
    const empB = await prisma.employee.create({ data: { externalId: 'EMP_B', name: 'B', source: 'manual' } })

    await webhook(
      validPayload({ employee_external_id: 'EMP_A', event_type: 'LOGIN', event_time: '2026-08-30T08:00:00+07:00', event_id: 'evt_a_1' })
    )
    await webhook(
      validPayload({ employee_external_id: 'EMP_B', event_type: 'LOGIN', event_time: '2026-08-30T08:30:00+07:00', event_id: 'evt_b_1' })
    )
    await webhook(
      validPayload({ employee_external_id: 'EMP_A', event_type: 'LOGOUT', event_time: '2026-08-30T16:00:00+07:00', event_id: 'evt_a_2' })
    )
    await webhook(
      validPayload({ employee_external_id: 'EMP_B', event_type: 'LOGOUT', event_time: '2026-08-30T17:00:00+07:00', event_id: 'evt_b_2' })
    )

    const sessionA = await prisma.attendanceSession.findFirstOrThrow({ where: { employeeId: empA.id } })
    const sessionB = await prisma.attendanceSession.findFirstOrThrow({ where: { employeeId: empB.id } })

    expect(sessionA.status).toBe('CLOSED')
    expect(sessionB.status).toBe('CLOSED')
    expect(sessionA.logoutTime?.toISOString()).toBe(new Date('2026-08-30T16:00:00+07:00').toISOString())
    expect(sessionB.logoutTime?.toISOString()).toBe(new Date('2026-08-30T17:00:00+07:00').toISOString())

    const allSessions = await prisma.attendanceSession.findMany()
    expect(allSessions).toHaveLength(2)
  })

  // T8 test case: "LOGOUT đến đúng lúc job cron cũng đang flag phiên đó
  // (race condition) -> không bị lỗi dữ liệu (đảm bảo 1 trong 2 thắng nhất
  // quán)."
  it('a LOGOUT racing the stale-flag sweep resolves to exactly one consistent winner', async () => {
    const employee = await prisma.employee.create({
      data: { externalId: 'EMP_RACE', name: 'Race Guy', source: 'manual' },
    })
    const twentyHoursAgo = new Date(Date.now() - 20 * 60 * 60 * 1000)

    await webhook(
      validPayload({
        employee_external_id: 'EMP_RACE',
        event_type: 'LOGIN',
        event_time: twentyHoursAgo.toISOString(),
        event_id: 'evt_race_login',
      })
    )

    const openSession = await prisma.attendanceSession.findFirstOrThrow({ where: { employeeId: employee.id } })
    expect(openSession.status).toBe('OPEN')

    const [logoutRes] = await Promise.all([
      webhook(
        validPayload({
          employee_external_id: 'EMP_RACE',
          event_type: 'LOGOUT',
          event_time: new Date().toISOString(),
          event_id: 'evt_race_logout',
        })
      ),
      flagStaleOpenSessions(),
    ])

    expect(logoutRes.status).toBe(200)

    const finalSession = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: openSession.id } })
    expect(['CLOSED', 'FLAGGED']).toContain(finalSession.status)
    if (finalSession.status === 'CLOSED') {
      expect(finalSession.logoutTime).not.toBeNull()
    } else {
      expect(finalSession.logoutTime).toBeNull()
    }

    // Exactly one writer's transition landed for this session -- proving
    // the guarded update let only one of the two racing callers win.
    const transitionLogs = await prisma.auditLog.findMany({
      where: { entityId: openSession.id, action: { in: ['session_closed', 'session_auto_flagged_stale'] } },
    })
    expect(transitionLogs).toHaveLength(1)

    // Still exactly 1 session for this employee -- no duplicate/corrupted rows.
    const allSessions = await prisma.attendanceSession.findMany({ where: { employeeId: employee.id } })
    expect(allSessions).toHaveLength(1)
  })
})
