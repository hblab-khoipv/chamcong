import { useEffect, useState } from 'react'
import { rateBandsApi } from '../../api/endpoints'
import { ApiError } from '../../api/client'
import type { RateBand, RateBandGap } from '../../api/types'
import { RateBandForm } from './RateBandForm'
import { RateBandTimeline } from './RateBandTimeline'

export function RateBandsPage() {
  const [bands, setBands] = useState<RateBand[]>([])
  const [gaps, setGaps] = useState<RateBandGap[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingBand, setEditingBand] = useState<RateBand | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function refreshCoverage() {
    const coverage = await rateBandsApi.coverage()
    setGaps(coverage.gaps)
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([rateBandsApi.list(), rateBandsApi.coverage()])
      .then(([{ rateBands }, coverage]) => {
        if (cancelled) return
        setBands(rateBands)
        setGaps(coverage.gaps)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : 'Không tải được danh sách khung giờ.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function upsertLocal(band: RateBand) {
    setBands((prev) => {
      const exists = prev.some((b) => b.id === band.id)
      return exists ? prev.map((b) => (b.id === band.id ? band : b)) : [...prev, band]
    })
  }

  async function handleCreate(input: { name: string; start_time: string; end_time: string; rate_per_hour_vnd: number }) {
    const { rateBand } = await rateBandsApi.create(input)
    upsertLocal(rateBand)
    setShowCreateForm(false)
    setMessage(`Đã thêm khung giờ "${rateBand.name}".`)
    await refreshCoverage()
  }

  async function handleEditSave(input: { name: string; start_time: string; end_time: string; rate_per_hour_vnd: number }) {
    if (!editingBand) return
    const { rateBand } = await rateBandsApi.update(editingBand.id, input)
    upsertLocal(rateBand)
    setEditingBand(null)
    setMessage(`Đã cập nhật khung giờ "${rateBand.name}".`)
    await refreshCoverage()
  }

  async function handleDelete(band: RateBand) {
    setActionError(null)
    try {
      const result = await rateBandsApi.remove(band.id)
      if (result && result.softDeleted) {
        upsertLocal(result.rateBand)
        setMessage(`Khung giờ "${band.name}" đã có dữ liệu chấm công, chỉ vô hiệu hoá thay vì xoá.`)
      } else {
        setBands((prev) => prev.filter((b) => b.id !== band.id))
        setMessage(`Đã xoá khung giờ "${band.name}".`)
      }
      await refreshCoverage()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Không thể xoá khung giờ.')
    }
  }

  if (loading) return <p>Đang tải...</p>
  if (loadError) return <p role="alert" className="form-error">{loadError}</p>

  const activeBands = bands.filter((b) => b.active)

  return (
    <div>
      <h1>Khung giờ tính giá</h1>

      <RateBandTimeline bands={activeBands} gaps={gaps} />

      {message && <p className="form-success">{message}</p>}
      {actionError && (
        <p role="alert" className="form-error">
          {actionError}
        </p>
      )}

      <div className="filters-row">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setShowCreateForm((v) => !v)
            setEditingBand(null)
          }}
        >
          {showCreateForm ? 'Đóng' : 'Thêm khung giờ'}
        </button>
      </div>

      {showCreateForm && <RateBandForm band={null} onSubmit={handleCreate} onCancel={() => setShowCreateForm(false)} />}
      {editingBand && (
        <RateBandForm
          key={editingBand.id}
          band={editingBand}
          onSubmit={handleEditSave}
          onCancel={() => setEditingBand(null)}
        />
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>Tên</th>
            <th>Bắt đầu</th>
            <th>Kết thúc</th>
            <th>Đơn giá (VNĐ/giờ)</th>
            <th>Trạng thái</th>
            <th>Hành động</th>
          </tr>
        </thead>
        <tbody>
          {bands.map((band) => (
            <tr key={band.id}>
              <td>{band.name}</td>
              <td>{band.startTime}</td>
              <td>{band.endTime}</td>
              <td>{band.ratePerHourVnd.toLocaleString('vi-VN')}</td>
              <td>
                <span className={band.active ? 'badge badge-active' : 'badge badge-inactive'}>
                  {band.active ? 'Đang áp dụng' : 'Đã vô hiệu hoá'}
                </span>
              </td>
              <td>
                <div className="row-actions">
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditingBand(band)}>
                    Sửa
                  </button>
                  <button type="button" className="btn btn-danger btn-small" onClick={() => handleDelete(band)}>
                    Xoá
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {bands.length === 0 && (
            <tr>
              <td colSpan={6}>Chưa có khung giờ nào.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
