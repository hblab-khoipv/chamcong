import type { Holiday } from '../../api/types'

const WEEKDAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const MONTH_NAMES = [
  'Tháng 1',
  'Tháng 2',
  'Tháng 3',
  'Tháng 4',
  'Tháng 5',
  'Tháng 6',
  'Tháng 7',
  'Tháng 8',
  'Tháng 9',
  'Tháng 10',
  'Tháng 11',
  'Tháng 12',
]

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

interface MiniCalendarProps {
  year: number
  month: number // 1-12
  holidays: Holiday[]
  onPrevMonth: () => void
  onNextMonth: () => void
}

export function MiniCalendar({ year, month, holidays, onPrevMonth, onNextMonth }: MiniCalendarProps) {
  const holidaysByDate = new Map(holidays.map((h) => [h.holidayDate, h]))
  const daysInMonth = new Date(year, month, 0).getDate()
  const firstWeekday = new Date(year, month - 1, 1).getDay()

  const cells: Array<{ key: string; day: number | null; holiday: Holiday | null }> = []
  for (let i = 0; i < firstWeekday; i++) {
    cells.push({ key: `empty-${i}`, day: null, holiday: null })
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${year}-${pad2(month)}-${pad2(day)}`
    cells.push({ key: dateKey, day, holiday: holidaysByDate.get(dateKey) ?? null })
  }

  return (
    <div className="mini-calendar-wrapper">
      <div className="mini-calendar-header">
        <button type="button" className="btn btn-ghost btn-small" onClick={onPrevMonth} aria-label="Tháng trước">
          ‹
        </button>
        <strong>
          {MONTH_NAMES[month - 1]} {year}
        </strong>
        <button type="button" className="btn btn-ghost btn-small" onClick={onNextMonth} aria-label="Tháng sau">
          ›
        </button>
      </div>
      <div className="mini-calendar">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="mini-calendar-day mini-calendar-day-empty">
            {label}
          </div>
        ))}
        {cells.map((cell) =>
          cell.day === null ? (
            <div key={cell.key} className="mini-calendar-day mini-calendar-day-empty" />
          ) : (
            <div
              key={cell.key}
              className={cell.holiday ? 'mini-calendar-day mini-calendar-day-holiday' : 'mini-calendar-day'}
              title={cell.holiday ? cell.holiday.name : undefined}
              data-testid={cell.holiday ? `holiday-day-${cell.key}` : undefined}
            >
              {cell.day}
            </div>
          )
        )}
      </div>
    </div>
  )
}
