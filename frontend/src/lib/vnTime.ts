// Vietnam is a fixed UTC+7 offset with no DST (see backend AGENTS.md /
// lib/timeOfDay.ts). These helpers mirror that convention on the frontend
// for display/grouping purposes only (no rate calculation happens here).
const VN_OFFSET_MINUTES = 7 * 60

export function vnDateKey(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input
  const vn = new Date(date.getTime() + VN_OFFSET_MINUTES * 60_000)
  return vn.toISOString().slice(0, 10)
}

export function formatVnDateTime(input: string | Date | null): string {
  if (input === null) return '—'
  const date = typeof input === 'string' ? new Date(input) : input
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

export function formatVnTime(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatVnMoney(amount: number): string {
  return new Intl.NumberFormat('vi-VN').format(amount) + ' ₫'
}
