export type EmployeeSource = 'synced' | 'manual'

export interface Employee {
  id: string
  externalId: string | null
  name: string
  phone: string | null
  source: EmployeeSource
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface RateBand {
  id: string
  name: string
  startTime: string
  endTime: string
  ratePerHourVnd: number
  durationHours: number
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface RateBandGap {
  startTime: string
  endTime: string
}

export interface RateBandCoverage {
  bands: RateBand[]
  gaps: RateBandGap[]
}

export type HolidayRateType = 'PERCENT' | 'FIXED'

export interface Holiday {
  id: string
  holidayDate: string
  name: string
  rateType: HolidayRateType
  rateValue: number
  active: boolean
  createdAt: string
  updatedAt: string
}

export type AttendanceEventType = 'LOGIN' | 'LOGOUT'
export type AttendanceEventProcessStatus = 'PROCESSED' | 'UNMATCHED' | string

export interface AttendanceEvent {
  id: string
  employeeExternalId: string
  employeeId: string | null
  eventType: AttendanceEventType
  eventTime: string
  processStatus: AttendanceEventProcessStatus
  receivedAt: string
}

export type AttendanceSessionStatus = 'OPEN' | 'CLOSED' | 'FLAGGED' | 'MANUAL'

export interface AttendanceSession {
  id: string
  employeeId: string
  loginTime: string | null
  logoutTime: string | null
  status: AttendanceSessionStatus
  totalHours: number
  totalAmountVnd: number
  computedAt: string | null
  computationError: boolean
  computationErrorMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface AttendanceSessionSegment {
  id: string
  rateBandId: string | null
  holidayId: string | null
  segmentStart: string
  segmentEnd: string
  hours: number
  rateAppliedVnd: number
  amountVnd: number
}

export interface AttendanceSessionWithSegments extends AttendanceSession {
  segments: AttendanceSessionSegment[]
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
