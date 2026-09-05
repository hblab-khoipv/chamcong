import type { AttendanceSession } from '../../api/types'

export const COMPUTATION_ERROR_TEXT =
  'Tính lại tiền công thất bại: các đoạn và tổng tiền đang hiển thị là kết quả cũ, chưa khớp với giờ vào/ra hiện tại.'

interface ComputationErrorNoticeProps {
  session: Pick<AttendanceSession, 'computationError' | 'computationErrorMessage'>
}

export function ComputationErrorNotice({ session }: ComputationErrorNoticeProps) {
  if (!session.computationError) return null

  return (
    <p role="alert" className="form-error">
      {COMPUTATION_ERROR_TEXT}
      {session.computationErrorMessage ? ` Chi tiết: ${session.computationErrorMessage}` : ''}
    </p>
  )
}
