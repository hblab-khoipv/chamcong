// T16: payroll report + CSV/xlsx export for reconciliation. Depends on T9
// (rate splitting -- consumes its already-persisted totalHours/
// totalAmountVnd snapshots, no recomputation here) and T12 (auth).
import { Prisma } from '@prisma/client'
import { Response, Router } from 'express'
import { AuthenticatedRequest, authenticate } from '../middleware/authenticate'
import { prisma } from '../lib/db'
import { buildPayrollReport, PayrollSessionInput } from '../lib/payrollReport'
import { buildPayrollCsv, buildPayrollWorkbook, PayrollSessionDetailInput } from '../lib/payrollExport'
import { vnDayStartInstant } from '../lib/timeOfDay'

const router = Router()

router.use(authenticate)

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string' || !DATE_REGEX.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

interface RangeParams {
  from: Date
  to: Date
  rangeStart: Date
  rangeEndExclusive: Date
  employeeId?: string
}

// `from`/`to` are VN calendar days (same date-only convention as
// holidays.holiday_date). A session belongs to the range by its anchor day
// -- login_time's VN calendar day, or logout_time's when login_time is null
// (an orphan-LOGOUT FLAGGED session, see T8) -- so an overnight shift is
// reported on the day it started, consistent with how the rate engine
// treats the session as one continuous shift.
function parseRangeParams(query: Record<string, unknown>): RangeParams | { error: string } {
  const fromDate = parseDateOnly(query.from)
  const toDate = parseDateOnly(query.to)
  if (!fromDate || !toDate) {
    return { error: 'from and to are required as YYYY-MM-DD' }
  }
  if (toDate < fromDate) {
    return { error: 'to must not be before from' }
  }
  const employeeId = typeof query.employee_id === 'string' && query.employee_id.trim() ? query.employee_id.trim() : undefined
  return {
    from: fromDate,
    to: toDate,
    rangeStart: vnDayStartInstant(fromDate),
    rangeEndExclusive: vnDayStartInstant(addDays(toDate, 1)),
    employeeId,
  }
}

async function fetchSessionsInRange(params: RangeParams) {
  const where: Prisma.AttendanceSessionWhereInput = {
    OR: [
      { loginTime: { gte: params.rangeStart, lt: params.rangeEndExclusive } },
      { AND: [{ loginTime: null }, { logoutTime: { gte: params.rangeStart, lt: params.rangeEndExclusive } }] },
    ],
  }
  if (params.employeeId) where.employeeId = params.employeeId

  return prisma.attendanceSession.findMany({ where, include: { employee: true }, orderBy: { loginTime: 'asc' } })
}

// Attendance events that never became a session at all (auto-create off,
// employee unrecognized) are otherwise invisible to this report -- surfaced
// as an additional completeness signal alongside FLAGGED sessions, per the
// PRD's "còn tồn tại session FLAGGED/UNMATCHED chưa xử lý" warning.
async function countUnmatchedEventsInRange(params: RangeParams): Promise<number> {
  return prisma.attendanceEvent.count({
    where: {
      processStatus: 'UNMATCHED',
      eventTime: { gte: params.rangeStart, lt: params.rangeEndExclusive },
    },
  })
}

function toPayrollSessionInputs(sessions: Awaited<ReturnType<typeof fetchSessionsInRange>>): PayrollSessionInput[] {
  return sessions.map((s) => ({
    employeeId: s.employeeId,
    status: s.status,
    totalHours: Number(s.totalHours),
    totalAmountVnd: s.totalAmountVnd,
    computationError: s.computationError,
  }))
}

router.get('/reports/payroll', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = parseRangeParams(req.query as Record<string, unknown>)
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error })
    return
  }

  const [sessions, unmatchedEventCount] = await Promise.all([
    fetchSessionsInRange(parsed),
    countUnmatchedEventsInRange(parsed),
  ])
  const employeeNamesById = new Map(sessions.map((s) => [s.employeeId, s.employee.name]))

  const report = buildPayrollReport(
    formatDateOnly(parsed.from),
    formatDateOnly(parsed.to),
    toPayrollSessionInputs(sessions),
    employeeNamesById,
    unmatchedEventCount
  )

  res.status(200).json({ report })
})

router.get('/reports/payroll/export', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = parseRangeParams(req.query as Record<string, unknown>)
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error })
    return
  }
  const format = typeof req.query.format === 'string' ? req.query.format.toLowerCase() : 'xlsx'
  if (format !== 'csv' && format !== 'xlsx') {
    res.status(400).json({ error: 'format must be csv or xlsx' })
    return
  }

  const [sessions, unmatchedEventCount] = await Promise.all([
    fetchSessionsInRange(parsed),
    countUnmatchedEventsInRange(parsed),
  ])
  const employeeNamesById = new Map(sessions.map((s) => [s.employeeId, s.employee.name]))

  const report = buildPayrollReport(
    formatDateOnly(parsed.from),
    formatDateOnly(parsed.to),
    toPayrollSessionInputs(sessions),
    employeeNamesById,
    unmatchedEventCount
  )

  const filenameBase = `payroll_${report.from}_${report.to}`

  if (format === 'csv') {
    const csv = buildPayrollCsv(report)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.csv"`)
    res.status(200).send(csv)
    return
  }

  const sessionDetails: PayrollSessionDetailInput[] = sessions
    .filter((s) => s.status === 'CLOSED' || s.status === 'MANUAL')
    .map((s) => ({
      employeeName: employeeNamesById.get(s.employeeId) ?? s.employeeId,
      loginTime: s.loginTime,
      logoutTime: s.logoutTime,
      status: s.status,
      hours: Number(s.totalHours),
      amountVnd: s.totalAmountVnd,
    }))

  const workbook = await buildPayrollWorkbook(report, sessionDetails)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.xlsx"`)
  res.status(200).send(workbook)
})

export default router
