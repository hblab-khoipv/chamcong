import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Routes, Route } from 'react-router-dom'
import { DashboardPage } from './DashboardPage'
import { NeedsAttentionPage } from './attendance/NeedsAttentionPage'
import { mockApi } from '../test-utils/fetchMock'
import { renderWithProviders } from '../test-utils/renderWithProviders'

const EMPLOYEES = [
  { id: 'emp-1', externalId: 'ext-1', name: 'Nguyễn Văn A', phone: null, source: 'synced', active: true, createdAt: '', updatedAt: '' },
  { id: 'emp-2', externalId: 'ext-2', name: 'Trần Thị B', phone: null, source: 'synced', active: true, createdAt: '', updatedAt: '' },
]

const TODAY = new Date().toISOString()

const SESSIONS = [
  {
    id: 'sess-open-1',
    employeeId: 'emp-1',
    loginTime: TODAY,
    logoutTime: null,
    status: 'OPEN',
    totalHours: 0,
    totalAmountVnd: 0,
    computedAt: null,
    computationError: false,
    computationErrorMessage: null,
    createdAt: TODAY,
    updatedAt: TODAY,
  },
  {
    id: 'sess-open-2',
    employeeId: 'emp-2',
    loginTime: TODAY,
    logoutTime: null,
    status: 'OPEN',
    totalHours: 0,
    totalAmountVnd: 0,
    computedAt: null,
    computationError: false,
    computationErrorMessage: null,
    createdAt: TODAY,
    updatedAt: TODAY,
  },
  {
    id: 'sess-flagged-1',
    employeeId: 'emp-1',
    loginTime: null,
    logoutTime: TODAY,
    status: 'FLAGGED',
    totalHours: 0,
    totalAmountVnd: 0,
    computedAt: null,
    computationError: false,
    computationErrorMessage: null,
    createdAt: TODAY,
    updatedAt: TODAY,
  },
  {
    id: 'sess-closed-1',
    employeeId: 'emp-2',
    loginTime: TODAY,
    logoutTime: TODAY,
    status: 'CLOSED',
    totalHours: 8,
    totalAmountVnd: 400000,
    computedAt: TODAY,
    computationError: false,
    computationErrorMessage: null,
    createdAt: TODAY,
    updatedAt: TODAY,
  },
]

const UNMATCHED_EVENTS = [
  {
    id: 'evt-1',
    employeeExternalId: 'ext-unknown',
    employeeId: null,
    eventType: 'LOGIN',
    eventTime: TODAY,
    processStatus: 'UNMATCHED',
    receivedAt: TODAY,
  },
]

function mockDashboardApi() {
  return mockApi(({ method, pathname, search }) => {
    if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees: EMPLOYEES } }
    if (method === 'GET' && pathname === '/api/attendance-sessions') {
      const status = search.get('status')
      const filtered = status ? SESSIONS.filter((s) => s.status === status) : SESSIONS
      return { status: 200, body: { attendanceSessions: filtered } }
    }
    if (method === 'GET' && pathname === '/api/attendance-events/unmatched') {
      return { status: 200, body: { attendanceEvents: UNMATCHED_EVENTS } }
    }
    if (method === 'GET' && pathname.startsWith('/api/rate-bands')) return { status: 200, body: { rateBands: [] } }
    if (method === 'GET' && pathname === '/api/holidays') return { status: 200, body: { holidays: [] } }
    return undefined
  })
}

describe('DashboardPage', () => {
  it('hiển thị đúng số session OPEN khi có N nhân viên đang chấm công', async () => {
    mockDashboardApi()
    renderWithProviders(<DashboardPage />, { authenticated: true })

    await waitFor(() => expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument())
    expect(screen.getByText('Trần Thị B')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument() // "Đang trong ca" stat
  })

  it('hiển thị đúng số lượng FLAGGED/UNMATCHED và bấm vào điều hướng đúng trang chi tiết', async () => {
    mockDashboardApi()
    renderWithProviders(
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/attendance/needs-attention" element={<NeedsAttentionPage />} />
      </Routes>,
      { route: '/dashboard', authenticated: true }
    )

    await waitFor(() => expect(screen.getByText('Phiên cần xử lý (FLAGGED)')).toBeInTheDocument())

    const flaggedCard = screen.getByText('Phiên cần xử lý (FLAGGED)').closest('a')!
    expect(flaggedCard).toHaveTextContent('1')

    const unmatchedCard = screen.getByText('Sự kiện chưa khớp (UNMATCHED)').closest('a')!
    expect(unmatchedCard).toHaveTextContent('1')

    const user = userEvent.setup()
    await user.click(flaggedCard)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Cần xử lý' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Phiên FLAGGED \(1\)/ })).toBeInTheDocument()
  })
})
