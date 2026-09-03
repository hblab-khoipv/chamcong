import request, { Response } from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { applyHolidayRate, getActiveHolidayForDate } from '../lib/holidayRate'
import { prisma } from '../lib/db'
import { createTestAdmin, TestAdmin } from './testUtils/auth'
import { resetDb } from './testUtils/db'

const app = createApp()

describe('T5 holiday CRUD', () => {
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

  // T5 test case: "Tạo ngày lễ PERCENT=200 cho ngày X → session rơi đúng
  // ngày X được nhân đôi đơn giá band tương ứng (test tích hợp với T9)."
  // T9 (rate splitting engine / attendance sessions) is Phase 4, out of
  // scope here — this exercises the PERCENT/FIXED arithmetic (T5 items 3-4)
  // and the internal date lookup (item 6) that T9 will call, without
  // building session machinery.
  it('PERCENT=200 holiday doubles a rate band\'s hourly rate via the internal lookup', async () => {
    const res = await post('/holidays').send({ holiday_date: '2026-09-02', name: 'Quốc khánh', rate_type: 'PERCENT', rate_value: 200 })
    expect(res.status).toBe(201)

    const holiday = await getActiveHolidayForDate(new Date('2026-09-02T10:00:00Z'))
    expect(holiday).not.toBeNull()
    expect(applyHolidayRate(23000, holiday!)).toBe(46000)
  })

  // T5 test case: "Tạo ngày lễ FIXED=50000 cho ngày Y → mọi giờ làm trong
  // ngày Y tính đúng 50,000đ/giờ bất kể band nào."
  it('FIXED=50000 holiday overrides the hourly rate regardless of the underlying band rate', async () => {
    const res = await post('/holidays').send({ holiday_date: '2026-09-03', name: 'Nghỉ đặc biệt', rate_type: 'FIXED', rate_value: 50000 })
    expect(res.status).toBe(201)

    const holiday = await getActiveHolidayForDate(new Date('2026-09-03T23:00:00Z'))
    expect(holiday).not.toBeNull()
    expect(applyHolidayRate(23000, holiday!)).toBe(50000)
    expect(applyHolidayRate(30000, holiday!)).toBe(50000)
  })

  // T5 test case: "Tạo trùng holiday_date → lỗi 409."
  it('rejects creating a second holiday on the same date -> 409', async () => {
    const first = await post('/holidays').send({ holiday_date: '2026-01-01', name: 'Tết Dương lịch', rate_type: 'PERCENT', rate_value: 200 })
    expect(first.status).toBe(201)

    const dup = await post('/holidays').send({ holiday_date: '2026-01-01', name: 'Trùng ngày', rate_type: 'FIXED', rate_value: 40000 })
    expect(dup.status).toBe(409)
  })

  // T5 test case: "Xoá/deactivate ngày lễ → session tính TRƯỚC thời điểm
  // xoá vẫn giữ nguyên số liệu lịch sử; session tính SAU thời điểm xoá
  // không còn áp dụng ưu đãi lễ."
  it('deactivating a holiday keeps historical segment amounts but stops future lookups from matching', async () => {
    const created = await post('/holidays').send({ holiday_date: '2026-04-30', name: 'Giải phóng miền Nam', rate_type: 'PERCENT', rate_value: 200 })
    const holidayId = created.body.holiday.id

    const employee = await prisma.employee.create({ data: { name: 'Holiday Emp', source: 'manual' } })
    const session = await prisma.attendanceSession.create({
      data: { employeeId: employee.id, loginTime: new Date('2026-04-30T00:00:00Z'), status: 'CLOSED' },
    })
    const segment = await prisma.attendanceSessionSegment.create({
      data: {
        sessionId: session.id,
        holidayId,
        segmentStart: new Date('2026-04-30T00:00:00Z'),
        segmentEnd: new Date('2026-04-30T03:00:00Z'),
        hours: 3,
        rateAppliedVnd: 46000,
        amountVnd: 138000,
      },
    })

    const res = await del(`/holidays/${holidayId}`)
    expect(res.status).toBe(200)
    expect(res.body.holiday.active).toBe(false)

    const preserved = await prisma.attendanceSessionSegment.findUnique({ where: { id: segment.id } })
    expect(preserved?.rateAppliedVnd).toBe(46000)
    expect(preserved?.amountVnd).toBe(138000)
    expect(preserved?.holidayId).toBe(holidayId)

    const lookupAfterDeactivate = await getActiveHolidayForDate(new Date('2026-04-30T10:00:00Z'))
    expect(lookupAfterDeactivate).toBeNull()
  })

  it('can create a future holiday ahead of time', async () => {
    const res = await post('/holidays').send({ holiday_date: '2030-01-01', name: 'Future NY', rate_type: 'PERCENT', rate_value: 200 })
    expect(res.status).toBe(201)
    expect(res.body.holiday.holidayDate).toBe('2030-01-01')
  })

  it('filters holidays by year', async () => {
    await post('/holidays').send({ holiday_date: '2026-01-01', name: '2026 NY', rate_type: 'PERCENT', rate_value: 200 })
    await post('/holidays').send({ holiday_date: '2027-01-01', name: '2027 NY', rate_type: 'PERCENT', rate_value: 200 })

    const res = await get('/holidays?year=2026')
    expect(res.status).toBe(200)
    expect(res.body.holidays).toHaveLength(1)
    expect(res.body.holidays[0].name).toBe('2026 NY')
  })

  it('updates a holiday\'s rate_type and rate_value', async () => {
    const created = (await post('/holidays').send({ holiday_date: '2026-05-01', name: 'Lao động', rate_type: 'PERCENT', rate_value: 200 })) as Response

    const res = await patch(`/holidays/${created.body.holiday.id}`).send({ rate_type: 'FIXED', rate_value: 45000 })

    expect(res.status).toBe(200)
    expect(res.body.holiday.rateType).toBe('FIXED')
    expect(res.body.holiday.rateValue).toBe(45000)
  })
})
