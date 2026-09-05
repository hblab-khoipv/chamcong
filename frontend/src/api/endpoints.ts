import { apiDelete, apiGet, apiGetBlob, apiPatch, apiPost } from './client'
import type {
  AttendanceEvent,
  AttendanceSession,
  AttendanceSessionStatus,
  AttendanceSessionWithSegments,
  Employee,
  EmployeeSource,
  Holiday,
  HolidayRateType,
  PayrollReport,
  RateBand,
  RateBandCoverage,
} from './types'

export const authApi = {
  login: (email: string, password: string) => apiPost<{ token: string }>('/auth/login', { email, password }),
}

export interface EmployeeListFilters {
  source?: EmployeeSource
  active?: boolean
  name?: string
}

function toQueryString(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value)
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

export const employeesApi = {
  list: (filters: EmployeeListFilters = {}) =>
    apiGet<{ employees: Employee[] }>(
      `/employees${toQueryString({
        source: filters.source,
        active: filters.active === undefined ? undefined : String(filters.active),
        name: filters.name,
      })}`
    ),
  create: (input: { name: string; phone?: string | null }) =>
    apiPost<{ employee: Employee }>('/employees', input),
  update: (id: string, input: { name?: string; phone?: string | null; active?: boolean }) =>
    apiPatch<{ employee: Employee }>(`/employees/${id}`, input),
  deactivate: (id: string) => apiDelete<{ employee: Employee }>(`/employees/${id}`),
  linkExternal: (id: string, externalId: string) =>
    apiPatch<{ employee: Employee }>(`/employees/${id}/link-external`, { external_id: externalId }),
}

export const rateBandsApi = {
  list: (active?: boolean) =>
    apiGet<{ rateBands: RateBand[] }>(`/rate-bands${toQueryString({ active: active === undefined ? undefined : String(active) })}`),
  coverage: () => apiGet<RateBandCoverage>('/rate-bands/coverage'),
  create: (input: { name: string; start_time: string; end_time: string; rate_per_hour_vnd: number }) =>
    apiPost<{ rateBand: RateBand }>('/rate-bands', input),
  update: (
    id: string,
    input: Partial<{ name: string; start_time: string; end_time: string; rate_per_hour_vnd: number; active: boolean }>
  ) => apiPatch<{ rateBand: RateBand }>(`/rate-bands/${id}`, input),
  remove: (id: string) => apiDelete<{ rateBand: RateBand; softDeleted: boolean } | null>(`/rate-bands/${id}`),
}

export const holidaysApi = {
  list: (year?: number) => apiGet<{ holidays: Holiday[] }>(`/holidays${toQueryString({ year: year ? String(year) : undefined })}`),
  create: (input: { holiday_date: string; name: string; rate_type: HolidayRateType; rate_value: number }) =>
    apiPost<{ holiday: Holiday }>('/holidays', input),
  update: (
    id: string,
    input: Partial<{ holiday_date: string; name: string; rate_type: HolidayRateType; rate_value: number; active: boolean }>
  ) => apiPatch<{ holiday: Holiday }>(`/holidays/${id}`, input),
  remove: (id: string) => apiDelete<{ holiday: Holiday }>(`/holidays/${id}`),
}

export const attendanceEventsApi = {
  unmatched: () => apiGet<{ attendanceEvents: AttendanceEvent[] }>('/attendance-events/unmatched'),
  reprocess: (id: string) => apiPost<{ attendanceEvent: AttendanceEvent }>(`/attendance-events/${id}/reprocess`),
}

export interface AttendanceSessionListFilters {
  status?: AttendanceSessionStatus
  employeeId?: string
}

export const attendanceSessionsApi = {
  list: (filters: AttendanceSessionListFilters = {}) =>
    apiGet<{ attendanceSessions: AttendanceSession[] }>(
      `/attendance-sessions${toQueryString({ status: filters.status, employeeId: filters.employeeId })}`
    ),
  get: (id: string) => apiGet<{ attendanceSession: AttendanceSessionWithSegments }>(`/attendance-sessions/${id}`),
  update: (id: string, input: { login_time?: string; logout_time?: string }) =>
    apiPatch<{ attendanceSession: AttendanceSessionWithSegments }>(`/attendance-sessions/${id}`, input),
}

export interface PayrollReportFilters {
  from: string
  to: string
  employeeId?: string
}

export const reportsApi = {
  payroll: (filters: PayrollReportFilters) =>
    apiGet<{ report: PayrollReport }>(
      `/reports/payroll${toQueryString({ from: filters.from, to: filters.to, employee_id: filters.employeeId })}`
    ),
  exportPayroll: (filters: PayrollReportFilters & { format: 'csv' | 'xlsx' }) =>
    apiGetBlob(
      `/reports/payroll/export${toQueryString({
        from: filters.from,
        to: filters.to,
        employee_id: filters.employeeId,
        format: filters.format,
      })}`
    ),
}
