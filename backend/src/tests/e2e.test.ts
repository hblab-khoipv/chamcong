// T18: end-to-end integration suite exercising the full webhook -> session
// -> rate engine -> admin correction -> payroll pipeline together, the way
// a real shift would flow through the system. Unlike the per-unit test
// files elsewhere in this directory, each test here drives the HTTP layer
// (webhooks + admin API) start to finish and asserts on the payroll report
// as the final source of truth, mirroring how an admin would actually
// verify the numbers.
//
// T17 (real webhook auth) is intentionally not implemented yet -- these
// tests hit POST /webhooks/attendance exactly as it exists today
// (unauthenticated), per the T18 brief.
import request, { Response } from 'supertest'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { prisma } from '../lib/db'
import { createTestAdmin, TestAdmin } from './testUtils/auth'
import { resetDb } from './testUtils/db'

const app = createApp()

function timeOfDay(hhmm: string): Date {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(1970, 0, 1, hours, minutes))
}

// Matches the PRD's seeded default: 3 bands covering 24h with no gap, all
// at the same 23,000đ/h example rate used throughout the spec's worked
// examples (docs/ERD.md, PRD section on T4 seed data).
async function createDefaultThreeBands(ratePerHourVnd = 23000) {
  await prisma.rateBand.create({ data: { name: 'Ca 1', startTime: timeOfDay('06:00'), endTime: timeOfDay('17:00'), ratePerHourVnd } })
  await prisma.rateBand.create({ data: { name: 'Ca 2', startTime: timeOfDay('17:00'), endTime: timeOfDay('00:00'), ratePerHourVnd } })
  await prisma.rateBand.create({ data: { name: 'Ca 3', startTime: timeOfDay('00:00'), endTime: timeOfDay('06:00'), ratePerHourVnd } })
}

function webhookPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    employee_external_id: 'EMP_E2E',
    employee_name: 'E2E Employee',
    event_type: 'LOGIN',
    event_time: '2026-01-05T09:00:00+07:00',
    event_id: 'evt_e2e',
    ...overrides,
  }
}

function webhook(payload: Record<string, unknown>): request.Test {
  return request(app).post('/webhooks/attendance').send(payload)
}

describe('T18 end-to-end scenarios', () => {
  let admin: TestAdmin
  const originalAutoCreate = process.env.AUTO_CREATE_EMPLOYEE_ON_WEBHOOK

  beforeEach(async () => {
    await resetDb()
    admin = await createTestAdmin()
  })

  afterEach(() => {
    if (originalAutoCreate === undefined) delete process.env.AUTO_CREATE_EMPLOYEE_ON_WEBHOOK
    else process.env.AUTO_CREATE_EMPLOYEE_ON_WEBHOOK = originalAutoCreate
  })

  afterAll(async () => {
    await resetDb()
  })

  function get(path: string): request.Test {
    return request(app).get(path).set('Authorization', `Bearer ${admin.token}`)
  }
  function patch(path: string): request.Test {
    return request(app).patch(path).set('Authorization', `Bearer ${admin.token}`)
  }
  function post(path: string): request.Test {
    return request(app).post(path).set('Authorization', `Bearer ${admin.token}`)
  }

  // Required T18 case: "login 09:00 -> logout 17:00 ngày thường -> payroll
  // report ra đúng 184.000đ".
  it('scenario 1: LOGIN 09:00 -> LOGOUT 17:00 on a normal day computes 8h/184,000đ and shows up in payroll', async () => {
    await createDefaultThreeBands()

    const loginRes = await webhook(
      webhookPayload({ employee_external_id: 'EMP_E2E_1', event_type: 'LOGIN', event_time: '2026-01-05T09:00:00+07:00', event_id: 'evt_e2e_1_login' })
    )
    expect(loginRes.status).toBe(200)

    const logoutRes = await webhook(
      webhookPayload({ employee_external_id: 'EMP_E2E_1', event_type: 'LOGOUT', event_time: '2026-01-05T17:00:00+07:00', event_id: 'evt_e2e_1_logout' })
    )
    expect(logoutRes.status).toBe(200)

    const employee = await prisma.employee.findUniqueOrThrow({ where: { externalId: 'EMP_E2E_1' } })
    const session = await prisma.attendanceSession.findFirstOrThrow({ where: { employeeId: employee.id } })
    expect(session.status).toBe('CLOSED')
    expect(Number(session.totalHours)).toBe(8)
    expect(session.totalAmountVnd).toBe(184000)

    const segments = await prisma.attendanceSessionSegment.findMany({ where: { sessionId: session.id } })
    expect(segments).toHaveLength(1)
    expect(segments[0].amountVnd).toBe(184000)

    const payrollRes = await get('/reports/payroll?from=2026-01-05&to=2026-01-05')
    expect(payrollRes.status).toBe(200)
    const row = payrollRes.body.report.rows.find((r: { employeeName: string }) => r.employeeName === 'E2E Employee')
    expect(row.totalAmountVnd).toBe(184000)
    expect(row.totalHours).toBe(8)
    expect(payrollRes.body.report.totalAmountVnd).toBe(184000)
    expect(payrollRes.body.report.hasUnresolvedSessions).toBe(false)
  })

  // Required T18 case: "cấu hình ngày lễ FIXED cho hôm nay -> login/logout
  // trong ngày -> tổng tiền đúng theo giá lễ." Uses a fixed calendar date
  // rather than the real wall-clock "today" so the assertion is
  // deterministic regardless of when the suite runs -- the mechanic under
  // test (a holiday configured for the session's own day) is identical.
  it('scenario 2: a FIXED holiday configured via the API overrides the normal band rate for a session that day', async () => {
    await createDefaultThreeBands(23000)

    const holidayRes = await post('/holidays').send({ holiday_date: '2026-09-02', name: 'Quốc khánh', rate_type: 'FIXED', rate_value: 50000 })
    expect(holidayRes.status).toBe(201)

    await webhook(
      webhookPayload({ employee_external_id: 'EMP_E2E_2', event_type: 'LOGIN', event_time: '2026-09-02T09:00:00+07:00', event_id: 'evt_e2e_2_login' })
    )
    await webhook(
      webhookPayload({ employee_external_id: 'EMP_E2E_2', event_type: 'LOGOUT', event_time: '2026-09-02T17:00:00+07:00', event_id: 'evt_e2e_2_logout' })
    )

    const employee = await prisma.employee.findUniqueOrThrow({ where: { externalId: 'EMP_E2E_2' } })
    const session = await prisma.attendanceSession.findFirstOrThrow({ where: { employeeId: employee.id } })
    expect(session.status).toBe('CLOSED')
    // FIXED=50,000đ/h overrides the underlying 23,000đ/h band rate entirely: 8h * 50,000 = 400,000đ.
    expect(session.totalAmountVnd).toBe(400000)

    const payrollRes = await get('/reports/payroll?from=2026-09-02&to=2026-09-02')
    const row = payrollRes.body.report.rows.find((r: { employeeName: string }) => r.employeeName === 'E2E Employee')
    expect(row.totalAmountVnd).toBe(400000)
  })

  // Required T18 case: "webhook nhân viên lạ, auto-create tắt -> Admin link
  // nhân viên -> reprocess -> payroll cuối cùng có đúng nhân viên và số
  // tiền."
  it('scenario 3: unknown employee with auto-create off -> admin links + reprocesses -> payroll has the right employee/amount', async () => {
    await createDefaultThreeBands()
    process.env.AUTO_CREATE_EMPLOYEE_ON_WEBHOOK = 'false'

    const loginRes = await webhook(
      webhookPayload({ employee_external_id: 'EMP_E2E_3', event_type: 'LOGIN', event_time: '2026-01-06T09:00:00+07:00', event_id: 'evt_e2e_3_login' })
    )
    expect(loginRes.status).toBe(200)

    let loginEvent = await prisma.attendanceEvent.findFirstOrThrow({ where: { dedupeKey: 'evt_e2e_3_login' } })
    expect(loginEvent.processStatus).toBe('UNMATCHED')
    expect(await prisma.employee.findUnique({ where: { externalId: 'EMP_E2E_3' } })).toBeNull()

    const unmatchedRes = await get('/attendance-events/unmatched')
    expect(unmatchedRes.body.attendanceEvents.some((e: { id: string }) => e.id === loginEvent.id)).toBe(true)

    // The LOGOUT for the same unknown employee also arrives while
    // unresolved, and must equally land as UNMATCHED rather than crashing
    // or silently attaching to some other employee.
    const logoutRes = await webhook(
      webhookPayload({ employee_external_id: 'EMP_E2E_3', event_type: 'LOGOUT', event_time: '2026-01-06T17:00:00+07:00', event_id: 'evt_e2e_3_logout' })
    )
    expect(logoutRes.status).toBe(200)
    let logoutEvent = await prisma.attendanceEvent.findFirstOrThrow({ where: { dedupeKey: 'evt_e2e_3_logout' } })
    expect(logoutEvent.processStatus).toBe('UNMATCHED')

    // Admin resolves it: creates/links the real employee record via the API...
    const manualEmployee = await prisma.employee.create({ data: { name: 'Nguyen Van E2E3', source: 'manual', active: true } })
    const linkRes = await patch(`/employees/${manualEmployee.id}/link-external`).send({ external_id: 'EMP_E2E_3' })
    expect(linkRes.status).toBe(200)

    // ...then reprocesses both events through the same pipeline the webhook uses.
    const reprocessLogin = await post(`/attendance-events/${loginEvent.id}/reprocess`)
    expect(reprocessLogin.status).toBe(200)
    expect(reprocessLogin.body.attendanceEvent.employeeId).toBe(manualEmployee.id)

    const reprocessLogout = await post(`/attendance-events/${logoutEvent.id}/reprocess`)
    expect(reprocessLogout.status).toBe(200)
    expect(reprocessLogout.body.attendanceEvent.employeeId).toBe(manualEmployee.id)

    const session = await prisma.attendanceSession.findFirstOrThrow({ where: { employeeId: manualEmployee.id } })
    expect(session.status).toBe('CLOSED')
    expect(session.totalAmountVnd).toBe(184000)

    const payrollRes = await get('/reports/payroll?from=2026-01-06&to=2026-01-06')
    expect(payrollRes.body.report.unmatchedEventCount).toBe(0)
    const row = payrollRes.body.report.rows.find((r: { employeeName: string }) => r.employeeName === 'Nguyen Van E2E3')
    expect(row.totalAmountVnd).toBe(184000)
    expect(payrollRes.body.report.hasUnresolvedSessions).toBe(false)
  })

  // Required T18 case: "nhân viên quên logout, hôm sau login lại -> session
  // hôm trước bị FLAGGED, Admin bổ sung giờ ra tay -> payroll phản ánh
  // đúng sau khi sửa."
  it('scenario 4: a missed logout auto-flags the previous session on next-day login, and a manual fix restores correct payroll', async () => {
    await createDefaultThreeBands()

    await webhook(
      webhookPayload({ employee_external_id: 'EMP_E2E_4', event_type: 'LOGIN', event_time: '2026-01-07T09:00:00+07:00', event_id: 'evt_e2e_4_day1_login' })
    )
    const employee = await prisma.employee.findUniqueOrThrow({ where: { externalId: 'EMP_E2E_4' } })
    const day1Session = await prisma.attendanceSession.findFirstOrThrow({ where: { employeeId: employee.id } })
    expect(day1Session.status).toBe('OPEN')

    // No LOGOUT for day 1 -- the employee forgot to clock out. The next
    // day's LOGIN must auto-flag the still-OPEN day-1 session.
    await webhook(
      webhookPayload({ employee_external_id: 'EMP_E2E_4', event_type: 'LOGIN', event_time: '2026-01-08T09:00:00+07:00', event_id: 'evt_e2e_4_day2_login' })
    )

    const flaggedDay1 = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: day1Session.id } })
    expect(flaggedDay1.status).toBe('FLAGGED')
    expect(flaggedDay1.logoutTime).toBeNull()

    const listRes = await get(`/attendance-sessions?status=FLAGGED&employeeId=${employee.id}`)
    expect(listRes.body.attendanceSessions.some((s: { id: string }) => s.id === day1Session.id)).toBe(true)

    // Admin fills in the missing logout_time by hand.
    const patchRes = await patch(`/attendance-sessions/${day1Session.id}`).send({ logout_time: '2026-01-07T17:00:00+07:00' })
    expect(patchRes.status).toBe(200)
    expect(patchRes.body.attendanceSession.status).toBe('MANUAL')
    expect(patchRes.body.attendanceSession.totalAmountVnd).toBe(184000)

    // Close out day 2 normally too, so the range's payroll reflects both days cleanly.
    await webhook(
      webhookPayload({ employee_external_id: 'EMP_E2E_4', event_type: 'LOGOUT', event_time: '2026-01-08T17:00:00+07:00', event_id: 'evt_e2e_4_day2_logout' })
    )

    const payrollRes = await get('/reports/payroll?from=2026-01-07&to=2026-01-08')
    const row = payrollRes.body.report.rows.find((r: { employeeName: string }) => r.employeeName === 'E2E Employee')
    expect(row.totalAmountVnd).toBe(368000) // 184,000 (fixed day 1) + 184,000 (day 2)
    expect(row.flaggedSessionCount).toBe(0)
    expect(payrollRes.body.report.hasUnresolvedSessions).toBe(false)
  })

  // Required T18 case: "20 nhân viên login gần như đồng thời -> không
  // session nào bị gán nhầm nhân viên."
  it(
    'scenario 5 (light load): 20 employees logging in concurrently each get their own correctly-attributed session',
    async () => {
      const employeeCount = 20
      const employees = await Promise.all(
        Array.from({ length: employeeCount }, (_, i) =>
          prisma.employee.create({ data: { externalId: `EMP_LOAD_${i}`, name: `Load Employee ${i}`, source: 'manual', active: true } })
        )
      )

      const results = await Promise.all(
        employees.map((employee, i) =>
          webhook(
            webhookPayload({
              employee_external_id: employee.externalId,
              employee_name: employee.name,
              event_type: 'LOGIN',
              event_time: '2026-01-09T09:00:00+07:00',
              event_id: `evt_load_${i}`,
            })
          )
        )
      )

      for (const res of results) {
        expect(res.status).toBe(200)
      }

      const sessions = await prisma.attendanceSession.findMany({ where: { employeeId: { in: employees.map((e) => e.id) } } })
      expect(sessions).toHaveLength(employeeCount)

      // Each employee has exactly one OPEN session, and it's their own --
      // no session was attributed to the wrong employee under concurrency.
      const sessionsByEmployee = new Map(sessions.map((s) => [s.employeeId, s]))
      for (const employee of employees) {
        const session = sessionsByEmployee.get(employee.id)
        expect(session).toBeDefined()
        expect(session?.status).toBe('OPEN')
      }

      const events = await prisma.attendanceEvent.findMany({ where: { dedupeKey: { in: Array.from({ length: employeeCount }, (_, i) => `evt_load_${i}`) } } })
      expect(events).toHaveLength(employeeCount)
      expect(events.every((e) => e.processStatus === 'PROCESSED')).toBe(true)
    },
    30000
  )
})
