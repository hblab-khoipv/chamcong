import type { AttendanceSessionStatus } from '../../api/types'

const LABELS: Record<AttendanceSessionStatus, string> = {
  OPEN: 'Đang mở',
  CLOSED: 'Đã đóng',
  FLAGGED: 'Cần xử lý',
  MANUAL: 'Đã sửa tay',
}

export function SessionStatusBadge({ status }: { status: AttendanceSessionStatus }) {
  return <span className={`badge badge-status-${status}`}>{LABELS[status]}</span>
}
