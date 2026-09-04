import { FormEvent, useState } from 'react'
import { attendanceSessionsApi } from '../../api/endpoints'
import type { AttendanceSession, AttendanceSessionWithSegments } from '../../api/types'
import { toVnDatetimeLocalInput, vnDatetimeLocalInputToIso } from '../../lib/vnTime'
import { SegmentsTable } from './SegmentsTable'

interface ManualCorrectionFormProps {
  session: AttendanceSession
  onSaved: (updated: AttendanceSessionWithSegments) => void
  onCancel: () => void
}

export function ManualCorrectionForm({ session, onSaved, onCancel }: ManualCorrectionFormProps) {
  const [loginTime, setLoginTime] = useState(toVnDatetimeLocalInput(session.loginTime))
  const [logoutTime, setLogoutTime] = useState(toVnDatetimeLocalInput(session.logoutTime))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<AttendanceSessionWithSegments | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const input: { login_time?: string; logout_time?: string } = {}
      if (loginTime) input.login_time = vnDatetimeLocalInputToIso(loginTime)
      if (logoutTime) input.logout_time = vnDatetimeLocalInputToIso(logoutTime)

      const { attendanceSession } = await attendanceSessionsApi.update(session.id, input)
      setResult(attendanceSession)
      onSaved(attendanceSession)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Có lỗi xảy ra.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="form-panel">
      <h3>Sửa giờ vào/ra</h3>
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <label htmlFor={`login-${session.id}`}>Giờ vào</label>
          <input
            id={`login-${session.id}`}
            type="datetime-local"
            value={loginTime}
            onChange={(e) => setLoginTime(e.target.value)}
          />
        </div>
        <div className="form-row">
          <label htmlFor={`logout-${session.id}`}>Giờ ra</label>
          <input
            id={`logout-${session.id}`}
            type="datetime-local"
            value={logoutTime}
            onChange={(e) => setLogoutTime(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            Lưu & tính lại
          </button>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Huỷ
          </button>
        </div>
      </form>

      {result && (
        <div>
          <p className="form-success">Đã lưu. Trạng thái mới: {result.status}.</p>
          <SegmentsTable segments={result.segments} totalHours={result.totalHours} totalAmountVnd={result.totalAmountVnd} />
        </div>
      )}
    </div>
  )
}
