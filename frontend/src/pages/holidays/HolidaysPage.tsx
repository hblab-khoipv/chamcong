import { useEffect, useRef, useState } from 'react'
import { holidaysApi } from '../../api/endpoints'
import { ApiError } from '../../api/client'
import type { Holiday } from '../../api/types'
import { HolidayForm } from './HolidayForm'
import { MiniCalendar } from './MiniCalendar'

const CURRENT_YEAR = new Date().getFullYear()

export function HolidaysPage() {
  const [year, setYear] = useState(CURRENT_YEAR)
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingHoliday, setEditingHoliday] = useState<Holiday | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const hasAutoJumpedToMonth = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    holidaysApi
      .list(year)
      .then(({ holidays: list }) => {
        if (cancelled) return
        setHolidays(list)
        // On first load, point the mini calendar at the earliest configured
        // holiday's month instead of always defaulting to today's month, so
        // a year with holidays outside the current month is visible.
        if (!hasAutoJumpedToMonth.current && list.length > 0) {
          hasAutoJumpedToMonth.current = true
          const earliest = [...list].sort((a, b) => a.holidayDate.localeCompare(b.holidayDate))[0]
          setMonth(Number(earliest.holidayDate.slice(5, 7)))
        }
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : 'Không tải được danh sách ngày lễ.')
      })
      .finally(() => {
        if (!cancelled) setInitialLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [year])

  function upsertLocal(holiday: Holiday) {
    setHolidays((prev) => {
      const exists = prev.some((h) => h.id === holiday.id)
      return exists ? prev.map((h) => (h.id === holiday.id ? holiday : h)) : [...prev, holiday]
    })
  }

  function jumpToDate(dateStr: string) {
    const [y, m] = dateStr.split('-').map(Number)
    setYear(y)
    setMonth(m)
  }

  async function handleCreate(input: { holiday_date: string; name: string; rate_type: 'PERCENT' | 'FIXED'; rate_value: number }) {
    const { holiday } = await holidaysApi.create(input)
    if (holiday.holidayDate.startsWith(String(year))) upsertLocal(holiday)
    setShowCreateForm(false)
    setMessage(`Đã thêm ngày lễ "${holiday.name}".`)
    jumpToDate(holiday.holidayDate)
  }

  async function handleEditSave(input: { holiday_date: string; name: string; rate_type: 'PERCENT' | 'FIXED'; rate_value: number }) {
    if (!editingHoliday) return
    const { holiday } = await holidaysApi.update(editingHoliday.id, input)
    upsertLocal(holiday)
    setEditingHoliday(null)
    setMessage(`Đã cập nhật ngày lễ "${holiday.name}".`)
    jumpToDate(holiday.holidayDate)
  }

  async function handleDelete(holiday: Holiday) {
    setActionError(null)
    try {
      const { holiday: updated } = await holidaysApi.remove(holiday.id)
      upsertLocal(updated)
      setMessage(`Đã xoá ngày lễ "${updated.name}".`)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Không thể xoá ngày lễ.')
    }
  }

  function goToPrevMonth() {
    if (month === 1) {
      setYear(year - 1)
      setMonth(12)
    } else {
      setMonth(month - 1)
    }
  }

  function goToNextMonth() {
    if (month === 12) {
      setYear(year + 1)
      setMonth(1)
    } else {
      setMonth(month + 1)
    }
  }

  const activeHolidays = holidays.filter((h) => h.active)

  if (initialLoading) return <p>Đang tải...</p>

  return (
    <div>
      <h1>Ngày lễ</h1>

      {loadError && (
        <p role="alert" className="form-error">
          {loadError}
        </p>
      )}

      <MiniCalendar
        year={year}
        month={month}
        holidays={activeHolidays}
        onPrevMonth={goToPrevMonth}
        onNextMonth={goToNextMonth}
      />

      {message && <p className="form-success">{message}</p>}
      {actionError && (
        <p role="alert" className="form-error">
          {actionError}
        </p>
      )}

      <div className="filters-row">
        <div className="form-row">
          <label htmlFor="holiday-year">Năm</label>
          <input
            id="holiday-year"
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value) || CURRENT_YEAR)}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setShowCreateForm((v) => !v)
            setEditingHoliday(null)
          }}
        >
          {showCreateForm ? 'Đóng' : 'Thêm ngày lễ'}
        </button>
      </div>

      {showCreateForm && <HolidayForm holiday={null} onSubmit={handleCreate} onCancel={() => setShowCreateForm(false)} />}
      {editingHoliday && (
        <HolidayForm
          key={editingHoliday.id}
          holiday={editingHoliday}
          onSubmit={handleEditSave}
          onCancel={() => setEditingHoliday(null)}
        />
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>Ngày</th>
            <th>Tên</th>
            <th>Loại</th>
            <th>Giá trị</th>
            <th>Trạng thái</th>
            <th>Hành động</th>
          </tr>
        </thead>
        <tbody>
          {holidays
            .slice()
            .sort((a, b) => a.holidayDate.localeCompare(b.holidayDate))
            .map((holiday) => (
              <tr key={holiday.id}>
                <td>{holiday.holidayDate}</td>
                <td>{holiday.name}</td>
                <td>{holiday.rateType === 'PERCENT' ? 'Phần trăm' : 'Cố định'}</td>
                <td>{holiday.rateType === 'PERCENT' ? `${holiday.rateValue}%` : holiday.rateValue.toLocaleString('vi-VN') + ' đ/giờ'}</td>
                <td>
                  <span className={holiday.active ? 'badge badge-active' : 'badge badge-inactive'}>
                    {holiday.active ? 'Đang áp dụng' : 'Đã vô hiệu hoá'}
                  </span>
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() => {
                        setShowCreateForm(false)
                        setEditingHoliday(holiday)
                      }}
                    >
                      Sửa
                    </button>
                    {holiday.active && (
                      <button type="button" className="btn btn-danger btn-small" onClick={() => handleDelete(holiday)}>
                        Xoá
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          {holidays.length === 0 && (
            <tr>
              <td colSpan={6}>Chưa có ngày lễ nào trong năm {year}.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
