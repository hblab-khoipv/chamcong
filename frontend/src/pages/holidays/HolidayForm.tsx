import { FormEvent, useState } from 'react'
import type { Holiday, HolidayRateType } from '../../api/types'

interface HolidayFormProps {
  holiday: Holiday | null
  onSubmit: (input: { holiday_date: string; name: string; rate_type: HolidayRateType; rate_value: number }) => Promise<void>
  onCancel: () => void
}

export function HolidayForm({ holiday, onSubmit, onCancel }: HolidayFormProps) {
  const [holidayDate, setHolidayDate] = useState(holiday?.holidayDate ?? '')
  const [name, setName] = useState(holiday?.name ?? '')
  const [rateType, setRateType] = useState<HolidayRateType>(holiday?.rateType ?? 'PERCENT')
  const [rateValue, setRateValue] = useState(String(holiday?.rateValue ?? ''))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit({ holiday_date: holidayDate, name, rate_type: rateType, rate_value: Number(rateValue) })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Có lỗi xảy ra.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="form-panel" onSubmit={handleSubmit}>
      <h2>{holiday ? 'Sửa ngày lễ' : 'Thêm ngày lễ'}</h2>
      <div className="form-row">
        <label htmlFor="holiday-date">Ngày</label>
        <input
          id="holiday-date"
          type="date"
          value={holidayDate}
          onChange={(e) => setHolidayDate(e.target.value)}
          required
        />
      </div>
      <div className="form-row">
        <label htmlFor="holiday-name">Tên ngày lễ</label>
        <input id="holiday-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="form-row">
        <label htmlFor="holiday-rate-type">Loại đơn giá</label>
        <select
          id="holiday-rate-type"
          value={rateType}
          onChange={(e) => setRateType(e.target.value as HolidayRateType)}
        >
          <option value="PERCENT">Phần trăm (%)</option>
          <option value="FIXED">Cố định (VNĐ/giờ)</option>
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="holiday-rate-value">
          {rateType === 'PERCENT' ? 'Hệ số (%)' : 'Đơn giá cố định (VNĐ/giờ)'}
        </label>
        <input
          id="holiday-rate-value"
          type="number"
          min={0}
          value={rateValue}
          onChange={(e) => setRateValue(e.target.value)}
          required
        />
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {holiday ? 'Lưu' : 'Thêm'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Huỷ
        </button>
      </div>
    </form>
  )
}
