import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { SessionDetailPage } from './SessionDetailPage'
import { mockApi } from '../../test-utils/fetchMock'
import { renderWithProviders } from '../../test-utils/renderWithProviders'

const EMPLOYEES = [
  { id: 'emp-1', externalId: 'ext-1', name: 'Nguyễn Văn A', phone: null, source: 'synced', active: true, createdAt: '', updatedAt: '' },
]

const RATE_BANDS = [
  { id: 'band-1', name: 'Ca ngày', startTime: '06:00', endTime: '17:00', ratePerHourVnd: 23000, active: true, createdAt: '', updatedAt: '' },
  { id: 'band-2', name: 'Ca tối', startTime: '17:00', endTime: '00:00', ratePerHourVnd: 23000, active: true, createdAt: '', updatedAt: '' },
]

const SESSION_WITH_SEGMENTS = {
  id: 'sess-1',
  employeeId: 'emp-1',
  loginTime: '2026-01-05T02:00:00.000Z', // 09:00 VN
  logoutTime: '2026-01-05T12:00:00.000Z', // 19:00 VN
  status: 'CLOSED',
  totalHours: 10,
  totalAmountVnd: 230000,
  computedAt: '2026-01-05T12:00:01.000Z',
  computationError: false,
  computationErrorMessage: null,
  createdAt: '2026-01-05T12:00:01.000Z',
  updatedAt: '2026-01-05T12:00:01.000Z',
  segments: [
    // Deliberately out of chronological order in the API response, to
    // verify the UI sorts by segmentStart rather than trusting array order.
    {
      id: 'seg-2',
      rateBandId: 'band-2',
      holidayId: null,
      segmentStart: '2026-01-05T10:00:00.000Z', // 17:00 VN
      segmentEnd: '2026-01-05T12:00:00.000Z', // 19:00 VN
      hours: 2,
      rateAppliedVnd: 23000,
      amountVnd: 46000,
    },
    {
      id: 'seg-1',
      rateBandId: 'band-1',
      holidayId: null,
      segmentStart: '2026-01-05T02:00:00.000Z', // 09:00 VN
      segmentEnd: '2026-01-05T10:00:00.000Z', // 17:00 VN
      hours: 8,
      rateAppliedVnd: 23000,
      amountVnd: 184000,
    },
  ],
}

describe('SessionDetailPage', () => {
  it('xem chi tiết session có nhiều segment → hiển thị đúng thứ tự thời gian, đúng số tiền từng đoạn và tổng', async () => {
    mockApi(({ method, pathname }) => {
      if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees: EMPLOYEES } }
      if (method === 'GET' && pathname === '/api/rate-bands') return { status: 200, body: { rateBands: RATE_BANDS } }
      if (method === 'GET' && pathname === `/api/attendance-sessions/${SESSION_WITH_SEGMENTS.id}`) {
        return { status: 200, body: { attendanceSession: SESSION_WITH_SEGMENTS } }
      }
      return undefined
    })

    renderWithProviders(
      <Routes>
        <Route path="/attendance/:id" element={<SessionDetailPage />} />
      </Routes>,
      { route: `/attendance/${SESSION_WITH_SEGMENTS.id}`, authenticated: true }
    )

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Chi tiết phiên chấm công' })).toBeInTheDocument())
    expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument()

    const rows = screen.getAllByRole('row').slice(1) // skip header row
    // First data row must be the earlier segment (09:00-17:00), even though
    // it was second in the API response.
    expect(within(rows[0]).getByText('184.000 ₫')).toBeInTheDocument()
    expect(within(rows[0]).getByText('8.00')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Ca ngày')).toBeInTheDocument()
    expect(within(rows[1]).getByText('46.000 ₫')).toBeInTheDocument()
    expect(within(rows[1]).getByText('2.00')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Ca tối')).toBeInTheDocument()

    // Footer/total row.
    const table = screen.getByRole('table')
    expect(within(table).getByText('10.00')).toBeInTheDocument()
    expect(within(table).getByText('230.000 ₫')).toBeInTheDocument()
  })

  it('segment không thuộc khung giờ nào → đánh dấu rõ là chưa phủ khung giờ', async () => {
    const withGap = {
      ...SESSION_WITH_SEGMENTS,
      id: 'sess-gap',
      totalAmountVnd: 184000,
      segments: [
        SESSION_WITH_SEGMENTS.segments[1],
        { ...SESSION_WITH_SEGMENTS.segments[0], rateBandId: null, rateAppliedVnd: 0, amountVnd: 0 },
      ],
    }
    mockApi(({ method, pathname }) => {
      if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees: EMPLOYEES } }
      if (method === 'GET' && pathname === '/api/rate-bands') return { status: 200, body: { rateBands: RATE_BANDS } }
      if (method === 'GET' && pathname === `/api/attendance-sessions/${withGap.id}`) {
        return { status: 200, body: { attendanceSession: withGap } }
      }
      return undefined
    })

    renderWithProviders(
      <Routes>
        <Route path="/attendance/:id" element={<SessionDetailPage />} />
      </Routes>,
      { route: `/attendance/${withGap.id}`, authenticated: true }
    )

    await waitFor(() => expect(screen.getByText('Ca ngày')).toBeInTheDocument())
    const gapRow = screen.getByText('Chưa phủ khung giờ').closest('tr') as HTMLElement
    // The gap segment is distinguishable from a real band priced at 0.
    expect(within(gapRow).getByText('0 ₫')).toBeInTheDocument()
  })

  it('phiên có computationError → cảnh báo số liệu hiển thị là kết quả cũ', async () => {
    const failed = {
      ...SESSION_WITH_SEGMENTS,
      id: 'sess-failed',
      computationError: true,
      computationErrorMessage: 'Rate band no longer exists',
    }
    mockApi(({ method, pathname }) => {
      if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees: EMPLOYEES } }
      if (method === 'GET' && pathname === '/api/rate-bands') return { status: 200, body: { rateBands: RATE_BANDS } }
      if (method === 'GET' && pathname === `/api/attendance-sessions/${failed.id}`) {
        return { status: 200, body: { attendanceSession: failed } }
      }
      return undefined
    })

    renderWithProviders(
      <Routes>
        <Route path="/attendance/:id" element={<SessionDetailPage />} />
      </Routes>,
      { route: `/attendance/${failed.id}`, authenticated: true }
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Tính lại tiền công thất bại')
    expect(alert).toHaveTextContent('Rate band no longer exists')
  })
})
