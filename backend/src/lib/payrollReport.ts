// T16: pure aggregation for the payroll report -- no DB access, so the
// CLOSED/MANUAL-counts-toward-totals decision (see AGENTS.md "Payroll
// report" note) is unit-testable without a database.
import { AttendanceSessionStatus } from '@prisma/client'

export interface PayrollSessionInput {
  employeeId: string
  status: AttendanceSessionStatus
  totalHours: number
  totalAmountVnd: number
  computationError: boolean
}

export interface PayrollReportRow {
  employeeId: string
  employeeName: string
  totalHours: number
  totalAmountVnd: number
  computedSessionCount: number
  flaggedSessionCount: number
}

export interface PayrollReport {
  from: string
  to: string
  rows: PayrollReportRow[]
  totalHours: number
  totalAmountVnd: number
  computedSessionCount: number
  flaggedSessionCount: number
  computationErrorSessionCount: number
  unmatchedEventCount: number
  hasUnresolvedSessions: boolean
}

// CLOSED (ordinary happy path) and MANUAL (hand-corrected, still fully
// computed by recomputeSessionSegments -- see T11 in AGENTS.md) both count as
// "resolved" toward payroll totals; only these two ever carry a trustworthy
// totalHours/totalAmountVnd. FLAGGED (missing a side, or auto-flagged stale)
// and OPEN (still ongoing) are excluded and never contribute.
const RESOLVED_STATUSES = new Set<AttendanceSessionStatus>(['CLOSED', 'MANUAL'])

export function buildPayrollReport(
  from: string,
  to: string,
  sessions: PayrollSessionInput[],
  employeeNamesById: Map<string, string>,
  unmatchedEventCount = 0
): PayrollReport {
  const byEmployee = new Map<string, PayrollReportRow>()
  let computationErrorSessionCount = 0

  for (const session of sessions) {
    if (session.computationError) computationErrorSessionCount += 1

    let row = byEmployee.get(session.employeeId)
    if (!row) {
      row = {
        employeeId: session.employeeId,
        employeeName: employeeNamesById.get(session.employeeId) ?? session.employeeId,
        totalHours: 0,
        totalAmountVnd: 0,
        computedSessionCount: 0,
        flaggedSessionCount: 0,
      }
      byEmployee.set(session.employeeId, row)
    }

    if (RESOLVED_STATUSES.has(session.status)) {
      row.totalHours += session.totalHours
      row.totalAmountVnd += session.totalAmountVnd
      row.computedSessionCount += 1
    } else if (session.status === 'FLAGGED') {
      row.flaggedSessionCount += 1
    }
    // OPEN sessions in range contribute to neither bucket -- they have no
    // total yet and aren't the "unresolved, needs admin action" case FLAGGED is.
  }

  const rows = Array.from(byEmployee.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName))

  const totals = rows.reduce(
    (acc, row) => ({
      totalHours: acc.totalHours + row.totalHours,
      totalAmountVnd: acc.totalAmountVnd + row.totalAmountVnd,
      computedSessionCount: acc.computedSessionCount + row.computedSessionCount,
      flaggedSessionCount: acc.flaggedSessionCount + row.flaggedSessionCount,
    }),
    { totalHours: 0, totalAmountVnd: 0, computedSessionCount: 0, flaggedSessionCount: 0 }
  )

  return {
    from,
    to,
    rows,
    ...totals,
    computationErrorSessionCount,
    unmatchedEventCount,
    hasUnresolvedSessions: totals.flaggedSessionCount > 0 || unmatchedEventCount > 0,
  }
}
