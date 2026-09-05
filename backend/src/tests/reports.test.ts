import ExcelJS from 'exceljs'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { prisma } from '../lib/db'
import { createTestAdmin, TestAdmin } from './testUtils/auth'
import { resetDb } from './testUtils/db'

const app = createApp()

// supertest's default text parser decodes the response as UTF-8, which is
// lossy for binary xlsx bytes -- this forces a raw Buffer instead so the
// exported workbook can be reloaded and inspected.
function binaryParser(res: any, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: string[] = []
  res.setEncoding('binary')
  res.on('data', (chunk: string) => chunks.push(chunk))
  res.on('end', () => callback(null, Buffer.from(chunks.join(''), 'binary')))
}

describe('T16 GET /reports/payroll', () => {
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

  // Required test case: "Báo cáo cho 1 nhân viên có 3 session trong kỳ ->
  // tổng đúng bằng tổng 3 session."
  it('sums exactly to the total of 3 CLOSED sessions for one employee in the period', async () => {
    const employee = await prisma.employee.create({ data: { name: 'Nguyen Van A', source: 'manual' } })
    for (const [login, logout, hours, amount] of [
      ['2026-01-05T09:00:00+07:00', '2026-01-05T17:00:00+07:00', 8, 184000],
      ['2026-01-10T09:00:00+07:00', '2026-01-10T16:30:00+07:00', 7.5, 172500],
      ['2026-01-20T08:00:00+07:00', '2026-01-20T17:00:00+07:00', 9, 207000],
    ] as const) {
      await prisma.attendanceSession.create({
        data: {
          employeeId: employee.id,
          loginTime: new Date(login),
          logoutTime: new Date(logout),
          status: 'CLOSED',
          totalHours: hours,
          totalAmountVnd: amount,
        },
      })
    }

    const res = await get('/reports/payroll?from=2026-01-01&to=2026-01-31')

    expect(res.status).toBe(200)
    expect(res.body.report.rows).toHaveLength(1)
    const row = res.body.report.rows[0]
    expect(row.employeeId).toBe(employee.id)
    expect(row.totalHours).toBe(24.5)
    expect(row.totalAmountVnd).toBe(563500)
    expect(row.computedSessionCount).toBe(3)
    expect(res.body.report.hasUnresolvedSessions).toBe(false)
  })

  // Required test case: "Báo cáo có session FLAGGED trong kỳ -> hiển thị
  // cảnh báo, không tính nhầm session đó vào tổng."
  it('shows the warning for a FLAGGED session in the period and excludes it from the total', async () => {
    const employee = await prisma.employee.create({ data: { name: 'Flagged Guy', source: 'manual' } })
    await prisma.attendanceSession.create({
      data: {
        employeeId: employee.id,
        loginTime: new Date('2026-01-05T09:00:00+07:00'),
        logoutTime: new Date('2026-01-05T17:00:00+07:00'),
        status: 'CLOSED',
        totalHours: 8,
        totalAmountVnd: 184000,
      },
    })
    await prisma.attendanceSession.create({
      data: {
        employeeId: employee.id,
        loginTime: new Date('2026-01-12T09:00:00+07:00'),
        logoutTime: null,
        status: 'FLAGGED',
      },
    })

    const res = await get('/reports/payroll?from=2026-01-01&to=2026-01-31')

    expect(res.status).toBe(200)
    const row = res.body.report.rows[0]
    expect(row.totalHours).toBe(8)
    expect(row.totalAmountVnd).toBe(184000)
    expect(row.computedSessionCount).toBe(1)
    expect(row.flaggedSessionCount).toBe(1)
    expect(res.body.report.hasUnresolvedSessions).toBe(true)
  })

  // A hand-corrected MANUAL session must still reach payroll -- decision (A).
  it('counts a MANUAL session toward the total same as CLOSED', async () => {
    const employee = await prisma.employee.create({ data: { name: 'Manual Guy', source: 'manual' } })
    await prisma.attendanceSession.create({
      data: {
        employeeId: employee.id,
        loginTime: new Date('2026-01-05T09:00:00+07:00'),
        logoutTime: new Date('2026-01-05T15:00:00+07:00'),
        status: 'MANUAL',
        totalHours: 6,
        totalAmountVnd: 138000,
      },
    })

    const res = await get('/reports/payroll?from=2026-01-01&to=2026-01-31')
    expect(res.body.report.rows[0].totalHours).toBe(6)
    expect(res.body.report.rows[0].computedSessionCount).toBe(1)
  })

  // Required test case: "Báo cáo với khoảng ngày rỗng dữ liệu -> trả về
  // bảng trống, không lỗi."
  it('returns an empty table with no error for a date range with no data', async () => {
    const res = await get('/reports/payroll?from=2030-01-01&to=2030-01-31')
    expect(res.status).toBe(200)
    expect(res.body.report.rows).toEqual([])
  })

  it('excludes sessions outside the selected date range', async () => {
    const employee = await prisma.employee.create({ data: { name: 'Outside Range', source: 'manual' } })
    await prisma.attendanceSession.create({
      data: {
        employeeId: employee.id,
        loginTime: new Date('2026-02-01T09:00:00+07:00'),
        logoutTime: new Date('2026-02-01T17:00:00+07:00'),
        status: 'CLOSED',
        totalHours: 8,
        totalAmountVnd: 184000,
      },
    })

    const res = await get('/reports/payroll?from=2026-01-01&to=2026-01-31')
    expect(res.body.report.rows).toEqual([])
  })

  it('filters by employee_id when provided', async () => {
    const empA = await prisma.employee.create({ data: { name: 'A', source: 'manual' } })
    const empB = await prisma.employee.create({ data: { name: 'B', source: 'manual' } })
    for (const emp of [empA, empB]) {
      await prisma.attendanceSession.create({
        data: {
          employeeId: emp.id,
          loginTime: new Date('2026-01-05T09:00:00+07:00'),
          logoutTime: new Date('2026-01-05T17:00:00+07:00'),
          status: 'CLOSED',
          totalHours: 8,
          totalAmountVnd: 184000,
        },
      })
    }

    const res = await get(`/reports/payroll?from=2026-01-01&to=2026-01-31&employee_id=${empA.id}`)
    expect(res.body.report.rows).toHaveLength(1)
    expect(res.body.report.rows[0].employeeId).toBe(empA.id)
  })

  it('counts UNMATCHED attendance events in the range toward the unresolved warning', async () => {
    await prisma.attendanceEvent.create({
      data: {
        employeeExternalId: 'EXT_UNKNOWN',
        employeeId: null,
        eventType: 'LOGIN',
        eventTime: new Date('2026-01-05T09:00:00+07:00'),
        rawPayload: {},
        dedupeKey: 'dedupe-unmatched-1',
        processStatus: 'UNMATCHED',
      },
    })

    const res = await get('/reports/payroll?from=2026-01-01&to=2026-01-31')
    expect(res.body.report.unmatchedEventCount).toBe(1)
    expect(res.body.report.hasUnresolvedSessions).toBe(true)
  })

  it('requires from and to as YYYY-MM-DD', async () => {
    const res = await get('/reports/payroll?from=not-a-date&to=2026-01-31')
    expect(res.status).toBe(400)
  })

  it('requires authentication', async () => {
    const res = await request(app).get('/reports/payroll?from=2026-01-01&to=2026-01-31')
    expect(res.status).toBe(401)
  })
})

describe('T16 GET /reports/payroll/export', () => {
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

  // Required test case: "Xuất CSV/Excel -> mở lại đọc đúng số liệu, đúng
  // encoding (không lỗi font tiếng Việt)."
  it('exports a CSV with a UTF-8 BOM and the correct Vietnamese employee name and totals', async () => {
    const employee = await prisma.employee.create({ data: { name: 'Nguyễn Văn Ánh', source: 'manual' } })
    await prisma.attendanceSession.create({
      data: {
        employeeId: employee.id,
        loginTime: new Date('2026-01-05T09:00:00+07:00'),
        logoutTime: new Date('2026-01-05T17:00:00+07:00'),
        status: 'CLOSED',
        totalHours: 8,
        totalAmountVnd: 184000,
      },
    })

    const res = await get('/reports/payroll/export?from=2026-01-01&to=2026-01-31&format=csv')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    const raw = res.text
    expect(raw.charCodeAt(0)).toBe(0xfeff)
    expect(raw).toContain('Nguyễn Văn Ánh')
    expect(raw).toContain('184000')
    expect(raw).toContain('8.00')
  })

  it('exports an xlsx workbook that reopens with the correct summary and detail sheets', async () => {
    const employee = await prisma.employee.create({ data: { name: 'Excel Guy', source: 'manual' } })
    await prisma.attendanceSession.create({
      data: {
        employeeId: employee.id,
        loginTime: new Date('2026-01-05T09:00:00+07:00'),
        logoutTime: new Date('2026-01-05T17:00:00+07:00'),
        status: 'CLOSED',
        totalHours: 8,
        totalAmountVnd: 184000,
      },
    })

    const res = await get('/reports/payroll/export?from=2026-01-01&to=2026-01-31&format=xlsx').buffer().parse(binaryParser)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('spreadsheetml')

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(res.body)
    const summary = workbook.getWorksheet('Tổng hợp')
    expect(summary).toBeDefined()
    const dataRow = summary!.getRow(2)
    expect(dataRow.getCell(1).value).toBe('Excel Guy')
    expect(dataRow.getCell(3).value).toBe(184000)

    const detail = workbook.getWorksheet('Chi tiết phiên')
    expect(detail).toBeDefined()
    expect(detail!.getRow(2).getCell(1).value).toBe('Excel Guy')
  })

  it('excludes a FLAGGED session from the exported CSV total', async () => {
    const employee = await prisma.employee.create({ data: { name: 'Flagged Export', source: 'manual' } })
    await prisma.attendanceSession.create({
      data: {
        employeeId: employee.id,
        loginTime: new Date('2026-01-05T09:00:00+07:00'),
        logoutTime: null,
        status: 'FLAGGED',
      },
    })

    const res = await get('/reports/payroll/export?from=2026-01-01&to=2026-01-31&format=csv')
    const raw = res.text
    expect(raw).toContain('Flagged Export')
    // The employee's own row totals 0 (only the FLAGGED session in range).
    expect(raw).toMatch(/Flagged Export,0\.00,0,0,1/)
  })

  it('rejects an unknown format', async () => {
    const res = await get('/reports/payroll/export?from=2026-01-01&to=2026-01-31&format=pdf')
    expect(res.status).toBe(400)
  })

  it('requires authentication', async () => {
    const res = await request(app).get('/reports/payroll/export?from=2026-01-01&to=2026-01-31&format=csv')
    expect(res.status).toBe(401)
  })
})
