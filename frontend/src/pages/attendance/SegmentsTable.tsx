import type { AttendanceSessionSegment } from '../../api/types'
import { formatVnDateTime, formatVnMoney } from '../../lib/vnTime'

interface SegmentsTableProps {
  segments: AttendanceSessionSegment[]
  totalHours: number
  totalAmountVnd: number
  rateBandNames?: Map<string, string>
}

export function SegmentsTable({ segments, totalHours, totalAmountVnd, rateBandNames }: SegmentsTableProps) {
  const sorted = [...segments].sort(
    (a, b) => new Date(a.segmentStart).getTime() - new Date(b.segmentStart).getTime()
  )

  return (
    <table className="data-table segment-table">
      <thead>
        <tr>
          <th>Từ</th>
          <th>Đến</th>
          <th>Khung giờ</th>
          <th>Ngày lễ</th>
          <th>Đơn giá áp dụng</th>
          <th>Số giờ</th>
          <th>Thành tiền</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((segment) => (
          <tr key={segment.id}>
            <td>{formatVnDateTime(segment.segmentStart)}</td>
            <td>{formatVnDateTime(segment.segmentEnd)}</td>
            <td>
              {segment.rateBandId === null ? (
                <span className="segment-uncovered">Chưa phủ khung giờ</span>
              ) : (
                rateBandNames?.get(segment.rateBandId) ?? '—'
              )}
            </td>
            <td>{segment.holidayId ? 'Có' : 'Không'}</td>
            <td className="amount">{formatVnMoney(segment.rateAppliedVnd)}/giờ</td>
            <td className="amount">{segment.hours.toFixed(2)}</td>
            <td className="amount">{formatVnMoney(segment.amountVnd)}</td>
          </tr>
        ))}
        {sorted.length === 0 && (
          <tr>
            <td colSpan={7}>Chưa có đoạn tính lương nào.</td>
          </tr>
        )}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={5}>
            <strong>Tổng</strong>
          </td>
          <td className="amount">
            <strong>{totalHours.toFixed(2)}</strong>
          </td>
          <td className="amount">
            <strong>{formatVnMoney(totalAmountVnd)}</strong>
          </td>
        </tr>
      </tfoot>
    </table>
  )
}
