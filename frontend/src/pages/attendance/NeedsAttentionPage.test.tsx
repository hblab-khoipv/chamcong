import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AttendanceSessionsPage } from './AttendanceSessionsPage'
import { NeedsAttentionPage } from './NeedsAttentionPage'
import { mockApi } from '../../test-utils/fetchMock'
import { renderWithProviders } from '../../test-utils/renderWithProviders'
import { formatVnDateTime } from '../../lib/vnTime'

const EMPLOYEES = [
  { id: 'emp-1', externalId: 'ext-1', name: 'Nguyễn Văn A', phone: null, source: 'synced', active: true, createdAt: '', updatedAt: '' },
  { id: 'emp-2', externalId: null, name: 'Trần Thị B (thủ công)', phone: null, source: 'manual', active: true, createdAt: '', updatedAt: '' },
]

const FLAGGED_SESSION = {
  id: 'sess-flagged-1',
  employeeId: 'emp-1',
  loginTime: null,
  logoutTime: '2026-03-01T10:00:00.000Z',
  status: 'FLAGGED',
  totalHours: 0,
  totalAmountVnd: 0,
  computedAt: null,
  computationError: false,
  computationErrorMessage: null,
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
}

const UNMATCHED_EVENT = {
  id: 'evt-1',
  employeeExternalId: 'ext-unknown-99',
  employeeId: null,
  eventType: 'LOGOUT',
  eventTime: '2026-03-02T10:00:00.000Z',
  processStatus: 'UNMATCHED',
  receivedAt: '2026-03-02T10:00:01.000Z',
}

// The session the backend pairs together once the LOGOUT above is replayed
// against the newly linked employee.
const SESSION_FROM_REPROCESS = {
  id: 'sess-from-evt-1',
  employeeId: 'emp-2',
  loginTime: '2026-03-02T01:00:00.000Z',
  logoutTime: UNMATCHED_EVENT.eventTime,
  status: 'CLOSED',
  totalHours: 9,
  totalAmountVnd: 225000,
  computedAt: '2026-03-02T10:00:02.000Z',
  computationError: false,
  computationErrorMessage: null,
  createdAt: '2026-03-02T01:00:00.000Z',
  updatedAt: '2026-03-02T10:00:02.000Z',
}

describe('NeedsAttentionPage', () => {
  it('sửa giờ vào cho 1 phiên FLAGGED và lưu → phiên chuyển trạng thái, số tiền hiển thị đúng ngay', async () => {
    mockApi(({ method, pathname, body }) => {
      if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees: EMPLOYEES } }
      if (method === 'GET' && pathname === '/api/attendance-sessions') {
        return { status: 200, body: { attendanceSessions: [FLAGGED_SESSION] } }
      }
      if (method === 'GET' && pathname === '/api/attendance-events/unmatched') {
        return { status: 200, body: { attendanceEvents: [] } }
      }
      if (method === 'PATCH' && pathname === `/api/attendance-sessions/${FLAGGED_SESSION.id}`) {
        const { login_time: loginTime } = body as { login_time: string }
        return {
          status: 200,
          body: {
            attendanceSession: {
              ...FLAGGED_SESSION,
              loginTime,
              status: 'MANUAL',
              totalHours: 2,
              totalAmountVnd: 50000,
              segments: [
                {
                  id: 'seg-1',
                  rateBandId: 'band-1',
                  holidayId: null,
                  segmentStart: loginTime,
                  segmentEnd: FLAGGED_SESSION.logoutTime,
                  hours: 2,
                  rateAppliedVnd: 25000,
                  amountVnd: 50000,
                },
              ],
            },
          },
        }
      }
      return undefined
    })

    renderWithProviders(<NeedsAttentionPage />, { authenticated: true })
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sửa giờ' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Sửa giờ' }))

    const loginInput = screen.getByLabelText('Giờ vào')
    await user.clear(loginInput)
    await user.type(loginInput, '2026-03-01T08:00')
    await user.click(screen.getByRole('button', { name: 'Lưu & tính lại' }))

    await waitFor(() => expect(screen.getByText(/Trạng thái mới: MANUAL/)).toBeInTheDocument())
    expect(screen.getAllByText('50.000 ₫').length).toBeGreaterThan(0)

    // Resolved sessions disappear from the "cần xử lý" FLAGGED tab.
    await waitFor(() => expect(screen.getByText('Phiên FLAGGED (0)')).toBeInTheDocument())
  })

  it('link nhân viên cho 1 event UNMATCHED ngay từ UI → event được xử lý, phiên tương ứng xuất hiện', async () => {
    let employees = EMPLOYEES
    let reprocessCalled = false
    mockApi(({ method, pathname, body }) => {
      if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees } }
      if (method === 'GET' && pathname === '/api/attendance-sessions') {
        return { status: 200, body: { attendanceSessions: reprocessCalled ? [SESSION_FROM_REPROCESS] : [] } }
      }
      if (method === 'GET' && pathname === '/api/attendance-events/unmatched') {
        return { status: 200, body: { attendanceEvents: reprocessCalled ? [] : [UNMATCHED_EVENT] } }
      }
      if (method === 'PATCH' && pathname === '/api/employees/emp-2/link-external') {
        const { external_id: externalId } = body as { external_id: string }
        expect(externalId).toBe(UNMATCHED_EVENT.employeeExternalId)
        const linked = { ...EMPLOYEES[1], externalId }
        employees = [EMPLOYEES[0], linked]
        return { status: 200, body: { employee: linked } }
      }
      if (method === 'POST' && pathname === `/api/attendance-events/${UNMATCHED_EVENT.id}/reprocess`) {
        reprocessCalled = true
        return {
          status: 200,
          body: { attendanceEvent: { ...UNMATCHED_EVENT, employeeId: 'emp-2', processStatus: 'PROCESSED' } },
        }
      }
      return undefined
    })

    renderWithProviders(<NeedsAttentionPage />, { authenticated: true, route: '/attendance/needs-attention?tab=unmatched' })
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByText(UNMATCHED_EVENT.employeeExternalId)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Liên kết nhân viên' }))

    const select = screen.getByLabelText(`Chọn nhân viên cho sự kiện ${UNMATCHED_EVENT.id}`)
    await user.selectOptions(select, 'emp-2')
    await user.click(screen.getByRole('button', { name: 'Liên kết & xử lý lại' }))

    await waitFor(() => expect(screen.queryByText(UNMATCHED_EVENT.employeeExternalId)).not.toBeInTheDocument())
    expect(screen.getByText('Đã liên kết nhân viên và xử lý lại sự kiện.')).toBeInTheDocument()
    expect(screen.getByText('Sự kiện UNMATCHED (0)')).toBeInTheDocument()

    // ...and the session that reprocessing produced now shows up in the
    // attendance history with the right employee, times and totals.
    cleanup()
    renderWithProviders(<AttendanceSessionsPage />, { authenticated: true, route: '/attendance' })

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    const row = within(screen.getByRole('table')).getByText('Trần Thị B (thủ công)').closest('tr') as HTMLElement
    expect(row).toHaveTextContent('9.00')
    expect(row).toHaveTextContent('225.000 ₫')
    expect(row).toHaveTextContent(formatVnDateTime(SESSION_FROM_REPROCESS.loginTime))
    expect(row).toHaveTextContent(formatVnDateTime(SESSION_FROM_REPROCESS.logoutTime))
  })

  // The form is pinned to Vietnam wall-clock time like every other surface,
  // so run this against a non-VN host clock where the two actually differ.
  describe('trên máy không ở múi giờ Việt Nam', () => {
    const originalTz = process.env.TZ

    beforeAll(() => {
      process.env.TZ = 'UTC'
    })
    afterAll(() => {
      if (originalTz === undefined) delete process.env.TZ
      else process.env.TZ = originalTz
    })

    it('đổi sang phiên FLAGGED khác → form nạp lại đúng giờ VN của phiên đang chọn', async () => {
      const sessionA = { ...FLAGGED_SESSION, id: 'sess-a', loginTime: null, logoutTime: '2026-03-01T10:00:00.000Z' }
      const sessionB = { ...FLAGGED_SESSION, id: 'sess-b', loginTime: '2026-03-02T01:00:00.000Z', logoutTime: null }
      const patched: Array<{ id: string; loginTime: string }> = []

      mockApi(({ method, pathname, body }) => {
        if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees: EMPLOYEES } }
        if (method === 'GET' && pathname === '/api/attendance-sessions') {
          return { status: 200, body: { attendanceSessions: [sessionA, sessionB] } }
        }
        if (method === 'GET' && pathname === '/api/attendance-events/unmatched') {
          return { status: 200, body: { attendanceEvents: [] } }
        }
        if (method === 'PATCH' && pathname.startsWith('/api/attendance-sessions/')) {
          const id = pathname.split('/').pop() as string
          const { login_time: loginTime } = body as { login_time: string }
          patched.push({ id, loginTime })
          // Only login_time was supplied, so the session stays FLAGGED.
          return {
            status: 200,
            body: { attendanceSession: { ...sessionB, loginTime, segments: [] } },
          }
        }
        return undefined
      })

      renderWithProviders(<NeedsAttentionPage />, { authenticated: true })
      const user = userEvent.setup()

      await waitFor(() => expect(screen.getAllByRole('button', { name: 'Sửa giờ' })).toHaveLength(2))
      const [editA, editB] = screen.getAllByRole('button', { name: 'Sửa giờ' })

      await user.click(editA)
      expect(screen.getByLabelText('Giờ ra')).toHaveValue('2026-03-01T17:00')
      await user.type(screen.getByLabelText('Giờ vào'), '2026-03-01T09:00')

      await user.click(editB)
      expect(screen.getByLabelText('Giờ vào')).toHaveValue('2026-03-02T08:00')
      expect(screen.getByLabelText('Giờ ra')).toHaveValue('')

      await user.clear(screen.getByLabelText('Giờ vào'))
      await user.type(screen.getByLabelText('Giờ vào'), '2026-03-02T07:30')
      await user.click(screen.getByRole('button', { name: 'Lưu & tính lại' }))

      await waitFor(() => expect(patched).toHaveLength(1))
      expect(patched[0]).toEqual({ id: 'sess-b', loginTime: '2026-03-02T00:30:00.000Z' })

      // Still FLAGGED, so the row stays -- but with the corrected time.
      await waitFor(() => expect(screen.getByText('Phiên FLAGGED (2)')).toBeInTheDocument())
      expect(screen.getByText(formatVnDateTime('2026-03-02T00:30:00.000Z'))).toBeInTheDocument()
    })
  })

  it('sự kiện UNMATCHED còn lại của cùng một external_id vẫn xử lý lại được sau khi nhân viên đã được liên kết', async () => {
    const linkedEmployees = [
      EMPLOYEES[0],
      { ...EMPLOYEES[1], externalId: UNMATCHED_EVENT.employeeExternalId },
    ]
    const sibling = { ...UNMATCHED_EVENT, id: 'evt-2', eventType: 'LOGIN', eventTime: '2026-03-02T01:00:00.000Z' }
    let reprocessCalled = false
    mockApi(({ method, pathname }) => {
      if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees: linkedEmployees } }
      if (method === 'GET' && pathname === '/api/attendance-sessions') {
        return { status: 200, body: { attendanceSessions: [] } }
      }
      if (method === 'GET' && pathname === '/api/attendance-events/unmatched') {
        return { status: 200, body: { attendanceEvents: reprocessCalled ? [] : [sibling] } }
      }
      if (method === 'POST' && pathname === `/api/attendance-events/${sibling.id}/reprocess`) {
        reprocessCalled = true
        return {
          status: 200,
          body: { attendanceEvent: { ...sibling, employeeId: 'emp-2', processStatus: 'PROCESSED' } },
        }
      }
      return undefined
    })

    renderWithProviders(<NeedsAttentionPage />, { authenticated: true, route: '/attendance/needs-attention?tab=unmatched' })
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByText(sibling.employeeExternalId)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: `Xử lý lại sự kiện ${sibling.id}` }))

    await waitFor(() => expect(screen.queryByText(sibling.employeeExternalId)).not.toBeInTheDocument())
    expect(screen.getByText('Đã xử lý lại sự kiện.')).toBeInTheDocument()
    expect(screen.getByText('Sự kiện UNMATCHED (0)')).toBeInTheDocument()
  })

  it('xử lý lại trả về trạng thái ERROR → sự kiện vẫn nằm trong danh sách và báo lỗi', async () => {
    mockApi(({ method, pathname }) => {
      if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees: EMPLOYEES } }
      if (method === 'GET' && pathname === '/api/attendance-sessions') {
        return { status: 200, body: { attendanceSessions: [] } }
      }
      if (method === 'GET' && pathname === '/api/attendance-events/unmatched') {
        return { status: 200, body: { attendanceEvents: [UNMATCHED_EVENT] } }
      }
      if (method === 'POST' && pathname === `/api/attendance-events/${UNMATCHED_EVENT.id}/reprocess`) {
        return { status: 200, body: { attendanceEvent: { ...UNMATCHED_EVENT, processStatus: 'ERROR' } } }
      }
      return undefined
    })

    renderWithProviders(<NeedsAttentionPage />, { authenticated: true, route: '/attendance/needs-attention?tab=unmatched' })
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByText(UNMATCHED_EVENT.employeeExternalId)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: `Xử lý lại sự kiện ${UNMATCHED_EVENT.id}` }))

    expect(await screen.findByRole('alert')).toHaveTextContent('trạng thái: ERROR')
    // The failed event must stay visible: nothing else in the admin UI lists it.
    expect(screen.getByText(UNMATCHED_EVENT.employeeExternalId)).toBeInTheDocument()
    expect(screen.getByText('Sự kiện UNMATCHED (1)')).toBeInTheDocument()
    expect(screen.queryByText('Đã xử lý lại sự kiện.')).not.toBeInTheDocument()
  })
})
