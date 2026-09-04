import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NeedsAttentionPage } from './NeedsAttentionPage'
import { mockApi } from '../../test-utils/fetchMock'
import { renderWithProviders } from '../../test-utils/renderWithProviders'

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
  eventType: 'LOGIN',
  eventTime: '2026-03-02T01:00:00.000Z',
  processStatus: 'UNMATCHED',
  receivedAt: '2026-03-02T01:00:01.000Z',
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

  it('link nhân viên cho 1 event UNMATCHED ngay từ UI → event được xử lý', async () => {
    let reprocessCalled = false
    mockApi(({ method, pathname, body }) => {
      if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees: EMPLOYEES } }
      if (method === 'GET' && pathname === '/api/attendance-sessions') {
        return { status: 200, body: { attendanceSessions: [] } }
      }
      if (method === 'GET' && pathname === '/api/attendance-events/unmatched') {
        return { status: 200, body: { attendanceEvents: reprocessCalled ? [] : [UNMATCHED_EVENT] } }
      }
      if (method === 'PATCH' && pathname === '/api/employees/emp-2/link-external') {
        const { external_id: externalId } = body as { external_id: string }
        expect(externalId).toBe(UNMATCHED_EVENT.employeeExternalId)
        return { status: 200, body: { employee: { ...EMPLOYEES[1], externalId } } }
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
  })
})
