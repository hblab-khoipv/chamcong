import { FormEvent, useState } from 'react'
import type { RateBand } from '../../api/types'

interface RateBandFormProps {
  band: RateBand | null
  onSubmit: (input: { name: string; start_time: string; end_time: string; rate_per_hour_vnd: number }) => Promise<void>
  onCancel: () => void
}

export function RateBandForm({ band, onSubmit, onCancel }: RateBandFormProps) {
  const [name, setName] = useState(band?.name ?? '')
  const [startTime, setStartTime] = useState(band?.startTime ?? '06:00')
  const [endTime, setEndTime] = useState(band?.endTime ?? '17:00')
  const [rate, setRate] = useState(String(band?.ratePerHourVnd ?? ''))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit({ name, start_time: startTime, end_time: endTime, rate_per_hour_vnd: Number(rate) })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Có lỗi xảy ra.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="form-panel" onSubmit={handleSubmit}>
      <h2>{band ? 'Sửa khung giờ' : 'Thêm khung giờ'}</h2>
      <div className="form-row">
        <label htmlFor="band-name">Tên</label>
        <input id="band-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="form-row">
        <label htmlFor="band-start">Giờ bắt đầu</label>
        <input id="band-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
      </div>
      <div className="form-row">
        <label htmlFor="band-end">Giờ kết thúc</label>
        <input id="band-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
      </div>
      <div className="form-row">
        <label htmlFor="band-rate">Đơn giá (VNĐ/giờ)</label>
        <input id="band-rate" type="number" min={1} value={rate} onChange={(e) => setRate(e.target.value)} required />
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {band ? 'Lưu' : 'Thêm'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Huỷ
        </button>
      </div>
    </form>
  )
}
