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

// T15 test case: "Xem chi tiết session có nhiều segment -> hiển thị đúng
// thứ tự thời gian, đúng số tiền từng đoạn và tổng." This is the read-only
// GET /attendance-sessions/:id endpoint added to back that screen -- unlike
// PATCH/recompute (T11), it must not mutate the session it reads.
describe('T15 GET /attendance-sessions/:id session detail', () => {
  let admin: TestAdmin

  beforeEach(async () => {
    await resetDb()
    admin = await createTestAdmin()
  })

  afterAll(async () => {
    await resetDb()
  })

  function get(path: string): request.Test {
    return request(app).get(path).set('Authorization', `Bearer ${admin.token}`)
  }

  it('returns a multi-segment session detail with segments in time order and a correct total', async () => {
    await createDefaultThreeBands(23000)
    const employee = await prisma.employee.create({ data: { name: 'Emp', source: 'manual' } })
    const session = await prisma.attendanceSession.create({
      data: {
        employeeId: employee.id,
        loginTime: new Date('2026-01-05T09:00:00+07:00'),
        logoutTime: new Date('2026-01-05T19:00:00+07:00'),
        status: 'CLOSED',
      },
    })
    await request(app)
      .post(`/attendance-sessions/${session.id}/recompute`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ confirm: true })

    const beforeGet = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: session.id } })

    const res = await get(`/attendance-sessions/${session.id}`)

    expect(res.status).toBe(200)
    const { attendanceSession } = res.body
    expect(attendanceSession.id).toBe(session.id)
    expect(attendanceSession.segments).toHaveLength(2)

    const [first, second] = attendanceSession.segments
    expect(new Date(first.segmentStart).getTime()).toBeLessThan(new Date(second.segmentStart).getTime())
    expect(first.hours).toBe(8) // Ca 1: 09:00-17:00
    expect(first.amountVnd).toBe(184000)
    expect(second.hours).toBe(2) // Ca 2: 17:00-19:00
    expect(second.amountVnd).toBe(46000)

    expect(attendanceSession.totalHours).toBe(10)
    expect(attendanceSession.totalAmountVnd).toBe(230000)

    // Read-only: fetching detail must not change the stored row at all.
    const afterGet = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(afterGet.updatedAt.getTime()).toBe(beforeGet.updatedAt.getTime())
    expect(afterGet.totalAmountVnd).toBe(230000)
  })

  it('returns 404 for a nonexistent session id', async () => {
    const res = await get('/attendance-sessions/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
  })

  it('requires authentication', async () => {
    const employee = await prisma.employee.create({ data: { name: 'Emp', source: 'manual' } })
    const session = await prisma.attendanceSession.create({
      data: { employeeId: employee.id, status: 'OPEN' },
    })

    const res = await request(app).get(`/attendance-sessions/${session.id}`)
    expect(res.status).toBe(401)
  })
})
