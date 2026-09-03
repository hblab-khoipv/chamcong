import request, { Response } from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { prisma } from '../lib/db'
import { createTestAdmin, TestAdmin } from './testUtils/auth'
import { resetDb } from './testUtils/db'

const app = createApp()

describe('T4 rate band CRUD', () => {
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
  function post(path: string): request.Test {
    return request(app).post(path).set('Authorization', `Bearer ${admin.token}`)
  }
  function patch(path: string): request.Test {
    return request(app).patch(path).set('Authorization', `Bearer ${admin.token}`)
  }
  function del(path: string): request.Test {
    return request(app).delete(path).set('Authorization', `Bearer ${admin.token}`)
  }

  async function createDefaultThreeBands(): Promise<{ ca1: Response; ca2: Response; ca3: Response }> {
    const ca1 = await post('/rate-bands').send({ name: 'Ca 1', start_time: '06:00', end_time: '17:00', rate_per_hour_vnd: 23000 })
    const ca2 = await post('/rate-bands').send({ name: 'Ca 2', start_time: '17:00', end_time: '00:00', rate_per_hour_vnd: 23000 })
    const ca3 = await post('/rate-bands').send({ name: 'Ca 3', start_time: '00:00', end_time: '06:00', rate_per_hour_vnd: 23000 })
    return { ca1, ca2, ca3 }
  }

  // T4 test case: "Tạo 3 band mặc định 06:00–17:00, 17:00–24:00, 00:00–06:00
  // → không chồng lấn, thành công." (17:00-24:00 is represented as
  // 17:00-00:00 per the documented end<=start midnight-wrap convention.)
  it('creates the 3 default bands (06-17, 17-00, 00-06) with no overlap', async () => {
    const { ca1, ca2, ca3 } = await createDefaultThreeBands()

    expect(ca1.status).toBe(201)
    expect(ca2.status).toBe(201)
    expect(ca3.status).toBe(201)
    expect(ca1.body.rateBand.startTime).toBe('06:00')
    expect(ca1.body.rateBand.endTime).toBe('17:00')
  })

  // T4 test case: "Tạo thêm band 16:00–18:00 (chồng với 06:00-17:00 và
  // 17:00-24:00) → lỗi."
  it('rejects a band that overlaps two existing active bands', async () => {
    await createDefaultThreeBands()

    const res = await post('/rate-bands').send({ name: 'Overlap', start_time: '16:00', end_time: '18:00', rate_per_hour_vnd: 20000 })

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/overlap/i)
  })

  // T4 test case: "Tạo band qua nửa đêm 00:00–06:00 → thành công, tính đúng
  // là 6 tiếng."
  it('creates band 00:00-06:00 successfully with a 6-hour duration', async () => {
    const res = await post('/rate-bands').send({ name: 'Ca 3', start_time: '00:00', end_time: '06:00', rate_per_hour_vnd: 23000 })

    expect(res.status).toBe(201)
    expect(res.body.rateBand.durationHours).toBe(6)
  })

  // T4 acceptance criteria: "Tạo band qua nửa đêm (vd 22:00–06:00) hoạt động
  // đúng, không bị coi là lỗi input." — a genuine midnight-crossing band.
  it('creates a genuinely midnight-crossing band 22:00-06:00 successfully with an 8-hour duration', async () => {
    const res = await post('/rate-bands').send({ name: 'Overnight', start_time: '22:00', end_time: '06:00', rate_per_hour_vnd: 25000 })

    expect(res.status).toBe(201)
    expect(res.body.rateBand.durationHours).toBe(8)
  })

  // T4 test case: "Coverage: với 3 band mặc định 06-17, 17-24, 00-06 → phủ
  // kín 24h, trả gaps: []."
  it('coverage reports no gaps for the 3 default bands', async () => {
    await createDefaultThreeBands()

    const res = await get('/rate-bands/coverage')

    expect(res.status).toBe(200)
    expect(res.body.bands).toHaveLength(3)
    expect(res.body.gaps).toEqual([])
  })

  // T4 test case: "Coverage: giả lập Admin tự sửa lại band 1 thành
  // 09:00–17:00 (thu hẹp lại, tạo khoảng trống) → trả đúng gap 06:00–09:00."
  it('coverage reports a 06:00-09:00 gap after band 1 is shrunk to 09:00-17:00', async () => {
    const { ca1 } = await createDefaultThreeBands()

    const shrink = await patch(`/rate-bands/${ca1.body.rateBand.id}`).send({ start_time: '09:00' })
    expect(shrink.status).toBe(200)

    const res = await get('/rate-bands/coverage')

    expect(res.status).toBe(200)
    expect(res.body.gaps).toEqual([{ startTime: '06:00', endTime: '09:00' }])
  })

  // T4 test case: "Xoá band đã có attendance_session_segment tham chiếu →
  // soft-delete, dữ liệu segment cũ vẫn còn nguyên giá trị rate_applied_vnd
  // đã chốt tại thời điểm tính."
  it('soft-deletes a band referenced by a historical segment, preserving the frozen rate_applied_vnd', async () => {
    const { ca1 } = await createDefaultThreeBands()
    const bandId = ca1.body.rateBand.id

    const employee = await prisma.employee.create({ data: { name: 'Ref Emp', source: 'manual' } })
    const session = await prisma.attendanceSession.create({
      data: { employeeId: employee.id, loginTime: new Date('2026-01-05T00:00:00Z'), status: 'CLOSED' },
    })
    const segment = await prisma.attendanceSessionSegment.create({
      data: {
        sessionId: session.id,
        rateBandId: bandId,
        segmentStart: new Date('2026-01-05T00:00:00Z'),
        segmentEnd: new Date('2026-01-05T03:00:00Z'),
        hours: 3,
        rateAppliedVnd: 23000,
        amountVnd: 69000,
      },
    })

    const res = await del(`/rate-bands/${bandId}`)

    expect(res.status).toBe(200)
    expect(res.body.softDeleted).toBe(true)
    expect(res.body.rateBand.active).toBe(false)

    const stillThere = await prisma.rateBand.findUnique({ where: { id: bandId } })
    expect(stillThere).not.toBeNull()

    const preserved = await prisma.attendanceSessionSegment.findUnique({ where: { id: segment.id } })
    expect(preserved?.rateAppliedVnd).toBe(23000)
    expect(preserved?.rateBandId).toBe(bandId)
  })

  it('hard-deletes a band with no historical references', async () => {
    const created = await post('/rate-bands').send({ name: 'Unused', start_time: '06:00', end_time: '07:00', rate_per_hour_vnd: 20000 })
    const bandId = created.body.rateBand.id

    const res = await del(`/rate-bands/${bandId}`)
    expect(res.status).toBe(204)

    const gone = await prisma.rateBand.findUnique({ where: { id: bandId } })
    expect(gone).toBeNull()
  })
})
