import { useEffect, useState } from 'react'
import { employeesApi, reportsApi } from '../../api/endpoints'
import { ApiError } from '../../api/client'
import type { Employee, PayrollReport } from '../../api/types'
import { formatVnMoney, vnDateKey } from '../../lib/vnTime'

// Defaults to the current VN calendar month -- the most common payroll
// reconciliation window -- so the page shows something useful on first load.
function defaultRange(): { from: string; to: string } {
  const todayKey = vnDateKey(new Date())
  const [y, m] = todayKey.split('-')
  return { from: `${y}-${m}-01`, to: todayKey }
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function ReportsPage() {
  const [{ from: initialFrom, to: initialTo }] = useState(defaultRange)
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [employeeId, setEmployeeId] = useState('')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [report, setReport] = useState<PayrollReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null)

  useEffect(() => {
    let cancelled = false
    employeesApi
      .list()
      .then(({ employees: list }) => {
        if (!cancelled) setEmployees(list)
      })
      .catch(() => {
        // The employee dropdown is only a convenience filter -- a failed
        // load here shouldn't block viewing the report itself.
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    reportsApi
      .payroll({ from, to, employeeId: employeeId || undefined })
      .then(({ report: data }) => {
        if (!cancelled) setReport(data)
      })
      .catch((err) => {
        if (!cancelled) {
          setReport(null)
          setError(err instanceof ApiError ? err.message : 'Không tải được báo cáo.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [from, to, employeeId])

  async function handleExport(format: 'csv' | 'xlsx') {
    setExportError(null)
    setExporting(format)
    try {
      const blob = await reportsApi.exportPayroll({ from, to, employeeId: employeeId || undefined, format })
      triggerBlobDownload(blob, `payroll_${from}_${to}.${format}`)
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Xuất file thất bại.')
    } finally {
      setExporting(null)
    }
  }

  return (
    <div>
      <h1>Báo cáo lương</h1>

      <div className="filters-row">
        <div className="form-row">
          <label htmlFor="report-from">Từ ngày</label>
          <input id="report-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="form-row">
          <label htmlFor="report-to">Đến ngày</label>
          <input id="report-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="form-row">
          <label htmlFor="report-employee">Nhân viên</label>
          <select id="report-employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Tất cả nhân viên</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && <p>Đang tải...</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      {!loading && !error && report && (
        <>
          {report.hasUnresolvedSessions && (
            <p role="alert" className="report-warning">
              Cảnh báo: khoảng ngày này còn {report.flaggedSessionCount} phiên FLAGGED
              {report.unmatchedEventCount > 0 ? ` và ${report.unmatchedEventCount} sự kiện UNMATCHED` : ''} chưa xử lý — số
              liệu bên dưới có thể chưa đầy đủ cho đến khi Admin xử lý xong.
            </p>
          )}

          <div className="report-actions">
            <button type="button" className="btn btn-secondary" disabled={exporting !== null} onClick={() => handleExport('csv')}>
              {exporting === 'csv' ? 'Đang xuất...' : 'Xuất CSV'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={exporting !== null} onClick={() => handleExport('xlsx')}>
              {exporting === 'xlsx' ? 'Đang xuất...' : 'Xuất Excel'}
            </button>
          </div>
          {exportError && (
            <p role="alert" className="form-error">
              {exportError}
            </p>
          )}

          <table className="data-table">
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th>Tổng giờ</th>
                <th>Tổng tiền</th>
                <th>Số phiên đã tính</th>
                <th>Số phiên FLAGGED</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.employeeId}>
                  <td>{row.employeeName}</td>
                  <td>{row.totalHours.toFixed(2)}</td>
                  <td>{formatVnMoney(row.totalAmountVnd)}</td>
                  <td>{row.computedSessionCount}</td>
                  <td>{row.flaggedSessionCount}</td>
                </tr>
              ))}
              {report.rows.length === 0 && (
                <tr>
                  <td colSpan={5}>Không có dữ liệu trong khoảng ngày đã chọn.</td>
                </tr>
              )}
            </tbody>
            {report.rows.length > 0 && (
              <tfoot>
                <tr>
                  <td>Tổng cộng</td>
                  <td>{report.totalHours.toFixed(2)}</td>
                  <td>{formatVnMoney(report.totalAmountVnd)}</td>
                  <td>{report.computedSessionCount}</td>
                  <td>{report.flaggedSessionCount}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </>
      )}
    </div>
  )
}
