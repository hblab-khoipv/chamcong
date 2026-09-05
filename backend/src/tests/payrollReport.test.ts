import { describe, expect, it } from 'vitest'
import { buildPayrollReport, PayrollSessionInput } from '../lib/payrollReport'

function session(overrides: Partial<PayrollSessionInput> = {}): PayrollSessionInput {
  return {
    employeeId: 'emp-1',
    status: 'CLOSED',
    totalHours: 8,
    totalAmountVnd: 184000,
    computationError: false,
    ...overrides,
  }
}

const NAMES = new Map([
  ['emp-1', 'Nguyen Van A'],
  ['emp-2', 'Tran Thi B'],
])

describe('T16 buildPayrollReport', () => {
  // Required test case: "Báo cáo cho 1 nhân viên có 3 session trong kỳ ->
  // tổng đúng bằng tổng 3 session."
  it('sums exactly to the total of 3 CLOSED sessions for one employee', () => {
    const report = buildPayrollReport(
      '2026-01-01',
      '2026-01-31',
      [
        session({ totalHours: 8, totalAmountVnd: 184000 }),
        session({ totalHours: 7.5, totalAmountVnd: 172500 }),
        session({ totalHours: 9, totalAmountVnd: 207000 }),
      ],
      NAMES
    )

    expect(report.rows).toHaveLength(1)
    expect(report.rows[0].totalHours).toBe(24.5)
    expect(report.rows[0].totalAmountVnd).toBe(563500)
    expect(report.rows[0].computedSessionCount).toBe(3)
    expect(report.totalHours).toBe(24.5)
    expect(report.totalAmountVnd).toBe(563500)
    expect(report.hasUnresolvedSessions).toBe(false)
  })

  // Required test case: "Báo cáo có session FLAGGED trong kỳ -> hiển thị
  // cảnh báo, không tính nhầm session đó vào tổng."
  it('excludes a FLAGGED session from totals and raises the unresolved warning', () => {
    const report = buildPayrollReport(
      '2026-01-01',
      '2026-01-31',
      [session({ totalHours: 8, totalAmountVnd: 184000 }), session({ status: 'FLAGGED', totalHours: 0, totalAmountVnd: 0 })],
      NAMES
    )

    expect(report.rows[0].totalHours).toBe(8)
    expect(report.rows[0].totalAmountVnd).toBe(184000)
    expect(report.rows[0].computedSessionCount).toBe(1)
    expect(report.rows[0].flaggedSessionCount).toBe(1)
    expect(report.hasUnresolvedSessions).toBe(true)
  })

  // Decision (A) from firstmate: MANUAL (hand-corrected, fully computed)
  // counts toward totals the same as CLOSED.
  it('counts a MANUAL session toward totals same as CLOSED', () => {
    const report = buildPayrollReport(
      '2026-01-01',
      '2026-01-31',
      [session({ status: 'MANUAL', totalHours: 6, totalAmountVnd: 138000 })],
      NAMES
    )
    expect(report.rows[0].totalHours).toBe(6)
    expect(report.rows[0].totalAmountVnd).toBe(138000)
    expect(report.rows[0].computedSessionCount).toBe(1)
  })

  it('excludes an OPEN session from totals and from the flagged warning', () => {
    const report = buildPayrollReport('2026-01-01', '2026-01-31', [session({ status: 'OPEN', totalHours: 0, totalAmountVnd: 0 })], NAMES)
    expect(report.rows[0].computedSessionCount).toBe(0)
    expect(report.rows[0].flaggedSessionCount).toBe(0)
    expect(report.hasUnresolvedSessions).toBe(false)
  })

  // Required test case: "Báo cáo với khoảng ngày rỗng dữ liệu -> trả về
  // bảng trống, không lỗi."
  it('returns an empty row list for no sessions, without error', () => {
    const report = buildPayrollReport('2026-01-01', '2026-01-31', [], NAMES)
    expect(report.rows).toEqual([])
    expect(report.totalHours).toBe(0)
    expect(report.totalAmountVnd).toBe(0)
    expect(report.hasUnresolvedSessions).toBe(false)
  })

  it('separates totals per employee and sorts rows by employee name', () => {
    const report = buildPayrollReport(
      '2026-01-01',
      '2026-01-31',
      [session({ employeeId: 'emp-2', totalHours: 5, totalAmountVnd: 100000 }), session({ employeeId: 'emp-1', totalHours: 8, totalAmountVnd: 184000 })],
      NAMES
    )
    expect(report.rows.map((r) => r.employeeName)).toEqual(['Nguyen Van A', 'Tran Thi B'])
    expect(report.totalHours).toBe(13)
    expect(report.totalAmountVnd).toBe(284000)
  })

  it('raises the unresolved warning from unmatched events even with no flagged sessions', () => {
    const report = buildPayrollReport('2026-01-01', '2026-01-31', [session()], NAMES, 2)
    expect(report.unmatchedEventCount).toBe(2)
    expect(report.hasUnresolvedSessions).toBe(true)
  })

  it('counts a computationError session separately without touching its (possibly stale) totals', () => {
    const report = buildPayrollReport(
      '2026-01-01',
      '2026-01-31',
      [session({ computationError: true, totalHours: 8, totalAmountVnd: 184000 })],
      NAMES
    )
    expect(report.computationErrorSessionCount).toBe(1)
    expect(report.totalAmountVnd).toBe(184000)
  })
})
