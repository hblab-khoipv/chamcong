import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { prisma } from '../lib/db'
import { createTestAdmin, TestAdmin } from './testUtils/auth'
import { resetDb } from './testUtils/db'

const app = createApp()

function timeOfDay(hhmm: string): Date {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(1970, 0, 1, hours, minutes))
}

async function createDefaultThreeBands(ratePerHourVnd = 23000) {
  await prisma.rateBand.create({ data: { name: 'Ca 1', startTime: timeOfDay('06:00'), endTime: timeOfDay('17:00'), ratePerHourVnd } })
  await prisma.rateBand.create({ data: { name: 'Ca 2', startTime: timeOfDay('17:00'), endTime: timeOfDay('00:00'), ratePerHourVnd } })
  await prisma.rateBand.create({ data: { name: 'Ca 3', startTime: timeOfDay('00:00'), endTime: timeOfDay('06:00'), ratePerHourVnd } })
}

describe('T11 manual correction & recompute', () => {
  let admin: TestAdmin

  beforeEach(async () => {
    await resetDb()
    admin = await createTestAdmin()
  })

  afterAll(async () => {
    await resetDb()
  })

  function patch(path: string): request.Test {
    return request(app).patch(path).set('Authorization', `Bearer ${admin.token}`)
  }
  function post(path: string): request.Test {
    return request(app).post(path).set('Authorization', `Bearer ${admin.token}`)
  }

  // T11 test case: "Sửa login_time của session FLAGGED (đang null) → tính
  // lại đúng số giờ/tiền mới."
  it('fills in a FLAGGED session missing login_time and recomputes correctly', async () => {
    await createDefaultThreeBands()
    const employee = await prisma.employee.create({ data: { name: 'Emp', source: 'manual' } })
    const flagged = await prisma.attendanceSession.create({
      data: { employeeId: employee.id, loginTime: null, logoutTime: new Date('2026-01-05T17:00:00+07:00'), status: 'FLAGGED' },
    })

    const res = await patch(`/attendance-sessions/${flagged.id}`).send({ login_time: '2026-01-05T09:00:00+07:00' })

    expect(res.status).toBe(200)
    expect(res.body.attendanceSession.status).toBe('MANUAL')
    expect(res.body.attendanceSession.totalHours).toBe(8)
    expect(res.body.attendanceSession.totalAmountVnd).toBe(184000)
    expect(res.body.attendanceSession.segments).toHaveLength(1)

    const updated = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: flagged.id } })
    expect(updated.loginTime?.toISOString()).toBe(new Date('2026-01-05T09:00:00+07:00').toISOString())
  })

  // T11 test case: "Sửa giờ khiến logout_time <= login_time → bị chặn, trả lỗi validate."
  it('rejects an edit that makes logout_time <= login_time', async () => {
    const employee = await prisma.employee.create({ data: { name: 'Emp', source: 'manual' } })
    const session = await prisma.attendanceSession.create({
      data: {
        employeeId: employee.id,
        loginTime: new Date('2026-01-05T09:00:00+07:00'),
        logoutTime: new Date('2026-01-05T17:00:00+07:00'),
        status: 'CLOSED',
      },
    })

    const res = await patch(`/attendance-sessions/${session.id}`).send({ logout_time: '2026-01-05T08:00:00+07:00' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/after login_time/i)
  })

  // T11 test case: "Sửa giờ khiến session chồng lấn với session khác của
  // cùng nhân viên → bị chặn."
  it('rejects an edit that overlaps another session for the same employee', async () => {
    const employee = await prisma.employee.create({ data: { name: 'Emp', source: 'manual' } })
    await prisma.attendanceSession.create({
      data: {
        employeeId: employee.id,
        loginTime: new Date('2026-01-05T09:00:00+07:00'),
        logoutTime: new Date('2026-01-05T12:00:00+07:00'),
        status: 'CLOSED',
      },
    })
    const target = await prisma.attendanceSession.create({
      data: {
        employeeId: employee.id,
        loginTime: new Date('2026-01-05T14:00:00+07:00'),
        logoutTime: new Date('2026-01-05T17:00:00+07:00'),
        status: 'CLOSED',
      },
    })

    const res = await patch(`/attendance-sessions/${target.id}`).send({ login_time: '2026-01-05T10:00:00+07:00' })

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/overlap/i)
  })

  // T11 test case: "Recompute 1 session cũ sau khi đơn giá đã đổi → số tiền
  // cập nhật theo đơn giá mới, audit log ghi rõ số cũ/số mới."
  it('recompute updates a session to the new rate and audit-logs old vs new totals', async () => {
    await createDefaultThreeBands(23000)
    const employee = await prisma.employee.create({ data: { name: 'Emp', source: 'manual' } })
    const session = await prisma.attendanceSession.create({
      data: {
        employeeId: employee.id,
        loginTime: new Date('2026-01-05T09:00:00+07:00'),
        logoutTime: new Date('2026-01-05T17:00:00+07:00'),
        status: 'CLOSED',
      },
    })
    await request(app).post(`/attendance-sessions/${session.id}/recompute`).set('Authorization', `Bearer ${admin.token}`).send({ confirm: true })
    let refreshed = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(refreshed.totalAmountVnd).toBe(184000)

    const band1 = await prisma.rateBand.findFirstOrThrow({ where: { name: 'Ca 1' } })
    await prisma.rateBand.update({ where: { id: band1.id }, data: { ratePerHourVnd: 30000 } })

    const res = await post(`/attendance-sessions/${session.id}/recompute`).send({ confirm: true })

    expect(res.status).toBe(200)
    expect(res.body.attendanceSession.totalAmountVnd).toBe(240000)

    const auditLog = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: session.id, action: 'session_recompute' },
      orderBy: { createdAt: 'desc' },
    })
    expect(auditLog.adminId).toBe(admin.id)
    expect((auditLog.before as { totalAmountVnd: number }).totalAmountVnd).toBe(184000)
    expect((auditLog.after as { totalAmountVnd: number }).totalAmountVnd).toBe(240000)
  })

  it('recompute without confirm=true is rejected', async () => {
    const employee = await prisma.employee.create({ data: { name: 'Emp', source: 'manual' } })
    const session = await prisma.attendanceSession.create({
      data: {
        employeeId: employee.id,
        loginTime: new Date('2026-01-05T09:00:00+07:00'),
        logoutTime: new Date('2026-01-05T17:00:00+07:00'),
        status: 'CLOSED',
      },
    })

    const res = await post(`/attendance-sessions/${session.id}/recompute`).send({})

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/confirm/i)
  })

  // T11 acceptance: "Audit log ghi đầy đủ, xem lại được lịch sử sửa của 1
  // session" -- who, what, before/after, when.
  it('a manual correction is fully audit-logged: who, before/after, when', async () => {
    const employee = await prisma.employee.create({ data: { name: 'Emp', source: 'manual' } })
    const session = await prisma.attendanceSession.create({
      data: {
        employeeId: employee.id,
        loginTime: new Date('2026-01-05T09:00:00+07:00'),
        logoutTime: new Date('2026-01-05T17:00:00+07:00'),
        status: 'CLOSED',
      },
    })

    await patch(`/attendance-sessions/${session.id}`).send({ logout_time: '2026-01-05T18:00:00+07:00' })

    const auditLog = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: session.id, action: 'session_manual_correction' },
    })
    expect(auditLog.adminId).toBe(admin.id)
    expect(auditLog.createdAt).toBeInstanceOf(Date)
    const before = auditLog.before as { logoutTime: string }
    const after = auditLog.after as { logoutTime: string; status: string }
    expect(new Date(before.logoutTime).toISOString()).toBe(new Date('2026-01-05T17:00:00+07:00').toISOString())
    expect(new Date(after.logoutTime).toISOString()).toBe(new Date('2026-01-05T18:00:00+07:00').toISOString())
    expect(after.status).toBe('MANUAL')
  })

  // T11 acceptance: "Kiểm tra quyền: chỉ Admin đã đăng nhập mới gọi được các API này."
  it('rejects PATCH and recompute without a valid admin token', async () => {
    const employee = await prisma.employee.create({ data: { name: 'Emp', source: 'manual' } })
    const session = await prisma.attendanceSession.create({
      data: {
        employeeId: employee.id,
        loginTime: new Date('2026-01-05T09:00:00+07:00'),
        logoutTime: new Date('2026-01-05T17:00:00+07:00'),
        status: 'CLOSED',
      },
    })

    const patchRes = await request(app).patch(`/attendance-sessions/${session.id}`).send({ logout_time: '2026-01-05T18:00:00+07:00' })
    expect(patchRes.status).toBe(401)

    const recomputeRes = await request(app).post(`/attendance-sessions/${session.id}/recompute`).send({ confirm: true })
    expect(recomputeRes.status).toBe(401)
  })
})
