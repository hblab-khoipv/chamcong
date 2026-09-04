import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { attendanceEventsApi, attendanceSessionsApi, employeesApi } from '../../api/endpoints'
import { ApiError } from '../../api/client'
import type { AttendanceEvent, AttendanceSession, AttendanceSessionWithSegments, Employee } from '../../api/types'
import { formatVnDateTime } from '../../lib/vnTime'
import { ManualCorrectionForm } from './ManualCorrectionForm'

type Tab = 'flagged' | 'unmatched'

export function NeedsAttentionPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab: Tab = searchParams.get('tab') === 'unmatched' ? 'unmatched' : 'flagged'
  const [tab, setTab] = useState<Tab>(initialTab)

  const [employees, setEmployees] = useState<Employee[]>([])
  const [flaggedSessions, setFlaggedSessions] = useState<AttendanceSession[]>([])
  const [unmatchedEvents, setUnmatchedEvents] = useState<AttendanceEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [editingSession, setEditingSession] = useState<AttendanceSession | null>(null)
  const [linkingEventId, setLinkingEventId] = useState<string | null>(null)
  const [selectedEmployeeByEvent, setSelectedEmployeeByEvent] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([employeesApi.list(), attendanceSessionsApi.list({ status: 'FLAGGED' }), attendanceEventsApi.unmatched()])
      .then(([{ employees: employeeList }, { attendanceSessions }, { attendanceEvents }]) => {
        if (cancelled) return
        setEmployees(employeeList)
        setFlaggedSessions(attendanceSessions)
        setUnmatchedEvents(attendanceEvents)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : 'Không tải được danh sách cần xử lý.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function selectTab(next: Tab) {
    setTab(next)
    setSearchParams(next === 'flagged' ? {} : { tab: next })
  }

  function handleSessionSaved(updated: AttendanceSessionWithSegments) {
    // Keep the form (and its recomputed segment/total preview) visible even
    // though the resolved session immediately drops out of the FLAGGED
    // table below -- closing it here would hide the very result the T15
    // acceptance criteria asks to show "ngay sau khi sửa".
    setFlaggedSessions((prev) => prev.filter((s) => s.id !== updated.id || updated.status === 'FLAGGED'))
    setMessage(
      updated.status === 'FLAGGED'
        ? 'Đã lưu, phiên vẫn còn thiếu thông tin nên vẫn ở trạng thái cần xử lý.'
        : 'Đã xử lý xong phiên chấm công.'
    )
  }

  const unlinkedEmployees = employees.filter((e) => e.externalId === null)

  async function handleLinkAndReprocess(event: AttendanceEvent) {
    const employeeId = selectedEmployeeByEvent[event.id]
    if (!employeeId) return
    setActionError(null)
    try {
      await employeesApi.linkExternal(employeeId, event.employeeExternalId)
      await attendanceEventsApi.reprocess(event.id)
      setUnmatchedEvents((prev) => prev.filter((e) => e.id !== event.id))
      setLinkingEventId(null)
      setMessage('Đã liên kết nhân viên và xử lý lại sự kiện.')
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Không thể liên kết/xử lý lại sự kiện.')
    }
  }

  const employeesById = new Map(employees.map((e) => [e.id, e]))

  if (loading) return <p>Đang tải...</p>
  if (loadError) return <p role="alert" className="form-error">{loadError}</p>

  return (
    <div>
      <h1>Cần xử lý</h1>

      <div className="filters-row">
        <button
          type="button"
          className={tab === 'flagged' ? 'btn btn-primary' : 'btn btn-secondary'}
          onClick={() => selectTab('flagged')}
        >
          Phiên FLAGGED ({flaggedSessions.length})
        </button>
        <button
          type="button"
          className={tab === 'unmatched' ? 'btn btn-primary' : 'btn btn-secondary'}
          onClick={() => selectTab('unmatched')}
        >
          Sự kiện UNMATCHED ({unmatchedEvents.length})
        </button>
      </div>

      {message && <p className="form-success">{message}</p>}
      {actionError && (
        <p role="alert" className="form-error">
          {actionError}
        </p>
      )}

      {tab === 'flagged' && (
        <div>
          {flaggedSessions.length === 0 ? (
            <p>Không có phiên nào cần xử lý.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nhân viên</th>
                  <th>Giờ vào</th>
                  <th>Giờ ra</th>
                  <th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {flaggedSessions.map((session) => (
                  <tr key={session.id}>
                    <td>{employeesById.get(session.employeeId)?.name ?? session.employeeId}</td>
                    <td>{session.loginTime ? formatVnDateTime(session.loginTime) : 'Thiếu'}</td>
                    <td>{session.logoutTime ? formatVnDateTime(session.logoutTime) : 'Thiếu'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => setEditingSession(editingSession?.id === session.id ? null : session)}
                      >
                        Sửa giờ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {editingSession && (
            <ManualCorrectionForm session={editingSession} onSaved={handleSessionSaved} onCancel={() => setEditingSession(null)} />
          )}
        </div>
      )}

      {tab === 'unmatched' && (
        <div>
          {unmatchedEvents.length === 0 ? (
            <p>Không có sự kiện nào chưa khớp.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mã NV (external_id)</th>
                  <th>Loại sự kiện</th>
                  <th>Thời điểm</th>
                  <th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {unmatchedEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{event.employeeExternalId}</td>
                    <td>{event.eventType}</td>
                    <td>{formatVnDateTime(event.eventTime)}</td>
                    <td>
                      {linkingEventId === event.id ? (
                        <div className="row-actions">
                          <select
                            aria-label={`Chọn nhân viên cho sự kiện ${event.id}`}
                            value={selectedEmployeeByEvent[event.id] ?? ''}
                            onChange={(e) =>
                              setSelectedEmployeeByEvent((prev) => ({ ...prev, [event.id]: e.target.value }))
                            }
                          >
                            <option value="">-- Chọn nhân viên --</option>
                            {unlinkedEmployees.map((employee) => (
                              <option key={employee.id} value={employee.id}>
                                {employee.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn btn-primary btn-small"
                            disabled={!selectedEmployeeByEvent[event.id]}
                            onClick={() => handleLinkAndReprocess(event)}
                          >
                            Liên kết & xử lý lại
                          </button>
                          <button type="button" className="btn btn-secondary btn-small" onClick={() => setLinkingEventId(null)}>
                            Huỷ
                          </button>
                        </div>
                      ) : (
                        <button type="button" className="btn btn-secondary btn-small" onClick={() => setLinkingEventId(event.id)}>
                          Liên kết nhân viên
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
