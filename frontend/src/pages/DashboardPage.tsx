import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { attendanceEventsApi, attendanceSessionsApi, employeesApi } from '../api/endpoints'
import type { AttendanceSession, Employee } from '../api/types'
import { formatVnMoney, formatVnTime, vnDateKey } from '../lib/vnTime'
import { ApiError } from '../api/client'

interface DashboardData {
  openSessions: AttendanceSession[]
  employeesById: Map<string, Employee>
  flaggedCount: number
  unmatchedCount: number
  todayTotalVnd: number
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [{ employees }, { attendanceSessions }, { attendanceEvents }] = await Promise.all([
          employeesApi.list(),
          attendanceSessionsApi.list(),
          attendanceEventsApi.unmatched(),
        ])
        if (cancelled) return

        const employeesById = new Map(employees.map((e) => [e.id, e]))
        const todayKey = vnDateKey(new Date())

        setData({
          openSessions: attendanceSessions.filter((s) => s.status === 'OPEN'),
          employeesById,
          flaggedCount: attendanceSessions.filter((s) => s.status === 'FLAGGED').length,
          unmatchedCount: attendanceEvents.length,
          todayTotalVnd: attendanceSessions
            .filter((s) => s.loginTime && vnDateKey(s.loginTime) === todayKey)
            .reduce((sum, s) => sum + s.totalAmountVnd, 0),
        })
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Không tải được dữ liệu tổng quan.')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <p role="alert" className="form-error">{error}</p>
  if (!data) return <p>Đang tải...</p>

  return (
    <div className="dashboard">
      <h1>Tổng quan</h1>
      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-value">{data.openSessions.length}</span>
          <span className="stat-label">Đang trong ca</span>
        </div>
        <Link className="stat-card stat-card-link" to="/attendance/needs-attention?tab=flagged">
          <span className="stat-value">{data.flaggedCount}</span>
          <span className="stat-label">Phiên cần xử lý (FLAGGED)</span>
        </Link>
        <Link className="stat-card stat-card-link" to="/attendance/needs-attention?tab=unmatched">
          <span className="stat-value">{data.unmatchedCount}</span>
          <span className="stat-label">Sự kiện chưa khớp (UNMATCHED)</span>
        </Link>
        <div className="stat-card">
          <span className="stat-value">{formatVnMoney(data.todayTotalVnd)}</span>
          <span className="stat-label">Lương tạm tính hôm nay</span>
        </div>
      </div>

      <h2>Nhân viên đang trong ca</h2>
      {data.openSessions.length === 0 ? (
        <p>Không có ai đang trong ca.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Nhân viên</th>
              <th>Giờ vào</th>
            </tr>
          </thead>
          <tbody>
            {data.openSessions.map((session) => (
              <tr key={session.id}>
                <td>{data.employeesById.get(session.employeeId)?.name ?? session.employeeId}</td>
                <td>{session.loginTime ? formatVnTime(session.loginTime) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
