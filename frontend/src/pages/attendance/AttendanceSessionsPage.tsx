import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { attendanceSessionsApi, employeesApi } from '../../api/endpoints'
import { ApiError } from '../../api/client'
import type { AttendanceSession, AttendanceSessionStatus, Employee } from '../../api/types'
import { formatVnDateTime, formatVnMoney, vnDateKey } from '../../lib/vnTime'
import { SessionStatusBadge } from './SessionStatusBadge'

const STATUS_OPTIONS: Array<{ value: AttendanceSessionStatus | ''; label: string }> = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'OPEN', label: 'Đang mở' },
  { value: 'CLOSED', label: 'Đã đóng' },
  { value: 'FLAGGED', label: 'Cần xử lý' },
  { value: 'MANUAL', label: 'Đã sửa tay' },
]

export function AttendanceSessionsPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [sessions, setSessions] = useState<AttendanceSession[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [employeeId, setEmployeeId] = useState('')
  const [status, setStatus] = useState<AttendanceSessionStatus | ''>('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    Promise.all([
      employeesApi.list(),
      attendanceSessionsApi.list({
        status: status || undefined,
        employeeId: employeeId || undefined,
      }),
    ])
      .then(([{ employees: employeeList }, { attendanceSessions }]) => {
        if (cancelled) return
        setEmployees(employeeList)
        setSessions(attendanceSessions)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : 'Không tải được danh sách chấm công.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [employeeId, status])

  const employeesById = new Map(employees.map((e) => [e.id, e]))

  const visibleSessions = sessions.filter((session) => {
    if (!session.loginTime) return !fromDate && !toDate
    const dayKey = vnDateKey(session.loginTime)
    if (fromDate && dayKey < fromDate) return false
    if (toDate && dayKey > toDate) return false
    return true
  })

  return (
    <div>
      <h1>Chấm công</h1>

      <div className="filters-row">
        <div className="form-row">
          <label htmlFor="filter-employee">Nhân viên</label>
          <select id="filter-employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Tất cả nhân viên</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label htmlFor="filter-status">Trạng thái</label>
          <select
            id="filter-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as AttendanceSessionStatus | '')}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label htmlFor="filter-from">Từ ngày</label>
          <input id="filter-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className="form-row">
          <label htmlFor="filter-to">Đến ngày</label>
          <input id="filter-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>

      {loading && <p>Đang tải...</p>}
      {loadError && (
        <p role="alert" className="form-error">
          {loadError}
        </p>
      )}

      {!loading && !loadError && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Nhân viên</th>
              <th>Giờ vào</th>
              <th>Giờ ra</th>
              <th>Trạng thái</th>
              <th>Tổng giờ</th>
              <th>Tổng tiền</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleSessions.map((session) => (
              <tr key={session.id}>
                <td>{employeesById.get(session.employeeId)?.name ?? session.employeeId}</td>
                <td>{session.loginTime ? formatVnDateTime(session.loginTime) : '—'}</td>
                <td>{session.logoutTime ? formatVnDateTime(session.logoutTime) : '—'}</td>
                <td>
                  <SessionStatusBadge status={session.status} />
                </td>
                <td>{session.totalHours.toFixed(2)}</td>
                <td>{formatVnMoney(session.totalAmountVnd)}</td>
                <td>
                  <Link to={`/attendance/${session.id}`}>Xem chi tiết</Link>
                </td>
              </tr>
            ))}
            {visibleSessions.length === 0 && (
              <tr>
                <td colSpan={7}>Không có phiên chấm công phù hợp.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
