import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AttendanceSessionsPage } from './AttendanceSessionsPage'
import { mockApi } from '../../test-utils/fetchMock'
import { renderWithProviders } from '../../test-utils/renderWithProviders'

const EMPLOYEES = [
  { id: 'emp-1', externalId: 'ext-1', name: 'Nguyễn Văn A', phone: null, source: 'synced', active: true, createdAt: '', updatedAt: '' },
  { id: 'emp-2', externalId: 'ext-2', name: 'Trần Thị B', phone: null, source: 'synced', active: true, createdAt: '', updatedAt: '' },
]

function session(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sess-1',
    employeeId: 'emp-1',
    loginTime: '2026-03-01T00:00:00.000Z',
    logoutTime: '2026-03-01T08:00:00.000Z',
    status: 'CLOSED',
    totalHours: 8,
    totalAmountVnd: 400000,
    computedAt: '2026-03-01T08:00:01.000Z',
    computationError: false,
    computationErrorMessage: null,
    createdAt: '2026-03-01T08:00:01.000Z',
    updatedAt: '2026-03-01T08:00:01.000Z',
    ...overrides,
  }
}

const SESSIONS = [
  session({ id: 'sess-a1-mar1', employeeId: 'emp-1', loginTime: '2026-03-01T00:00:00.000Z' }),
  session({ id: 'sess-a1-mar10', employeeId: 'emp-1', loginTime: '2026-03-10T00:00:00.000Z' }),
  session({ id: 'sess-b1-mar1', employeeId: 'emp-2', loginTime: '2026-03-01T00:00:00.000Z' }),
]

describe('AttendanceSessionsPage', () => {
  it('filter theo nhân viên + khoảng ngày trả đúng danh sách', async () => {
    mockApi(({ method, pathname, search }) => {
      if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees: EMPLOYEES } }
      if (method === 'GET' && pathname === '/api/attendance-sessions') {
        const employeeId = search.get('employeeId')
        const filtered = employeeId ? SESSIONS.filter((s) => s.employeeId === employeeId) : SESSIONS
        return { status: 200, body: { attendanceSessions: filtered } }
      }
      return undefined
    })

    renderWithProviders(<AttendanceSessionsPage />, { authenticated: true })
    const user = userEvent.setup()
    const table = () => screen.getByRole('table')

    await waitFor(() => expect(within(table()).getAllByText('Nguyễn Văn A')).toHaveLength(2))
    expect(within(table()).getAllByText('Trần Thị B')).toHaveLength(1)

    await user.selectOptions(screen.getByLabelText('Nhân viên'), 'emp-1')
    await waitFor(() => expect(within(table()).queryByText('Trần Thị B')).not.toBeInTheDocument())
    expect(within(table()).getAllByText('Nguyễn Văn A')).toHaveLength(2)

    await user.type(screen.getByLabelText('Từ ngày'), '2026-03-05')
    await waitFor(() => {
      const rows = within(table())
        .getAllByRole('row')
        .filter((r) => r.textContent?.includes('Nguyễn Văn A'))
      expect(rows).toHaveLength(1)
    })
  })

  it('phiên tính lại thất bại → đánh dấu số tiền là kết quả cũ ngay trên danh sách', async () => {
    const failed = session({
      id: 'sess-failed',
      computationError: true,
      computationErrorMessage: 'Rate band no longer exists',
    })
    mockApi(({ method, pathname }) => {
      if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees: EMPLOYEES } }
      if (method === 'GET' && pathname === '/api/attendance-sessions') {
        return { status: 200, body: { attendanceSessions: [failed, session({ id: 'sess-ok', employeeId: 'emp-2' })] } }
      }
      return undefined
    })

    renderWithProviders(<AttendanceSessionsPage />, { authenticated: true })

    await waitFor(() => expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument())
    const flags = screen.getAllByLabelText(/Tính lại tiền công thất bại/)
    expect(flags).toHaveLength(1)
    expect(flags[0].closest('tr')).toHaveTextContent('Nguyễn Văn A')
    expect(flags[0]).toHaveAttribute('title', 'Rate band no longer exists')
  })

  it('lỗi tải danh sách nhân viên vẫn hiển thị sau khi đổi bộ lọc phiên thành công', async () => {
    mockApi(({ method, pathname }) => {
      if (method === 'GET' && pathname === '/api/employees') return { status: 500, body: { error: 'boom' } }
      if (method === 'GET' && pathname === '/api/attendance-sessions') {
        return { status: 200, body: { attendanceSessions: SESSIONS } }
      }
      return undefined
    })

    renderWithProviders(<AttendanceSessionsPage />, { authenticated: true })
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('Trạng thái'), 'CLOSED')

    await waitFor(() => expect(screen.queryByText('Đang tải...')).not.toBeInTheDocument())
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
