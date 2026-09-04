import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { attendanceSessionsApi, employeesApi, rateBandsApi } from '../../api/endpoints'
import { ApiError } from '../../api/client'
import type { AttendanceSessionWithSegments, Employee, RateBand } from '../../api/types'
import { formatVnDateTime, formatVnMoney } from '../../lib/vnTime'
import { ComputationErrorNotice } from './ComputationErrorNotice'
import { SegmentsTable } from './SegmentsTable'
import { SessionStatusBadge } from './SessionStatusBadge'

export function SessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [session, setSession] = useState<AttendanceSessionWithSegments | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [rateBands, setRateBands] = useState<RateBand[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    Promise.all([attendanceSessionsApi.get(id), employeesApi.list(), rateBandsApi.list()])
      .then(([{ attendanceSession }, { employees: employeeList }, { rateBands: bandList }]) => {
        if (cancelled) return
        setSession(attendanceSession)
        setEmployees(employeeList)
        setRateBands(bandList)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : 'Không tải được chi tiết phiên chấm công.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) return <p>Đang tải...</p>
  if (loadError) return <p role="alert" className="form-error">{loadError}</p>
  if (!session) return null

  const employee = employees.find((e) => e.id === session.employeeId)
  const rateBandNames = new Map(rateBands.map((band) => [band.id, band.name]))

  return (
    <div>
      <p>
        <Link to="/attendance">← Quay lại danh sách chấm công</Link>
      </p>
      <h1>Chi tiết phiên chấm công</h1>

      <ComputationErrorNotice session={session} />

      <div className="form-panel">
        <div className="form-row">
          <label>Nhân viên</label>
          <span>{employee?.name ?? session.employeeId}</span>
        </div>
        <div className="form-row">
          <label>Giờ vào</label>
          <span>{session.loginTime ? formatVnDateTime(session.loginTime) : 'Thiếu'}</span>
        </div>
        <div className="form-row">
          <label>Giờ ra</label>
          <span>{session.logoutTime ? formatVnDateTime(session.logoutTime) : 'Thiếu'}</span>
        </div>
        <div className="form-row">
          <label>Trạng thái</label>
          <SessionStatusBadge status={session.status} />
        </div>
        <div className="form-row">
          <label>Tổng giờ</label>
          <span>{session.totalHours.toFixed(2)}</span>
        </div>
        <div className="form-row">
          <label>Tổng tiền</label>
          <span>{formatVnMoney(session.totalAmountVnd)}</span>
        </div>
      </div>

      <h2>Breakdown theo khung giờ</h2>
      <SegmentsTable
        segments={session.segments}
        totalHours={session.totalHours}
        totalAmountVnd={session.totalAmountVnd}
        rateBandNames={rateBandNames}
      />
    </div>
  )
}
