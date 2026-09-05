import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReportsPage } from './ReportsPage'
import { mockApi } from '../../test-utils/fetchMock'
import { renderWithProviders } from '../../test-utils/renderWithProviders'

const EMPLOYEES = [
  { id: 'emp-1', externalId: null, name: 'Nguyen Van A', phone: null, source: 'manual', active: true, createdAt: '', updatedAt: '' },
  { id: 'emp-2', externalId: null, name: 'Tran Thi B', phone: null, source: 'manual', active: true, createdAt: '', updatedAt: '' },
]

function baseReport(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    from: '2026-01-01',
    to: '2026-01-31',
    rows: [
      {
        employeeId: 'emp-1',
        employeeName: 'Nguyen Van A',
        totalHours: 24.5,
        totalAmountVnd: 563500,
        computedSessionCount: 3,
        flaggedSessionCount: 0,
      },
    ],
    totalHours: 24.5,
    totalAmountVnd: 563500,
    computedSessionCount: 3,
    flaggedSessionCount: 0,
    computationErrorSessionCount: 0,
    unmatchedEventCount: 0,
    hasUnresolvedSessions: false,
    ...overrides,
  }
}

describe('ReportsPage', () => {
  it('renders the per-employee summary table with correct totals', async () => {
    mockApi(({ method, pathname }) => {
      if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees: EMPLOYEES } }
      if (method === 'GET' && pathname === '/api/reports/payroll') return { status: 200, body: { report: baseReport() } }
      return undefined
    })

    renderWithProviders(<ReportsPage />, { authenticated: true })

    await waitFor(() => expect(screen.getByRole('cell', { name: 'Nguyen Van A' })).toBeInTheDocument())
    expect(screen.getAllByText('24.50')).toHaveLength(2) // one row + the totals footer
    expect(screen.getAllByText('563.500 ₫')).toHaveLength(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the unresolved-sessions warning when a FLAGGED session is in range', async () => {
    mockApi(({ method, pathname }) => {
      if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees: EMPLOYEES } }
      if (method === 'GET' && pathname === '/api/reports/payroll') {
        return {
          status: 200,
          body: {
            report: baseReport({
              rows: [
                {
                  employeeId: 'emp-1',
                  employeeName: 'Nguyen Van A',
                  totalHours: 8,
                  totalAmountVnd: 184000,
                  computedSessionCount: 1,
                  flaggedSessionCount: 1,
                },
              ],
              flaggedSessionCount: 1,
              hasUnresolvedSessions: true,
            }),
          },
        }
      }
      return undefined
    })

    renderWithProviders(<ReportsPage />, { authenticated: true })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('FLAGGED')
  })

  it('shows an empty table with no error for a date range with no data', async () => {
    mockApi(({ method, pathname }) => {
      if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees: EMPLOYEES } }
      if (method === 'GET' && pathname === '/api/reports/payroll') {
        return { status: 200, body: { report: baseReport({ rows: [], totalHours: 0, totalAmountVnd: 0, computedSessionCount: 0 }) } }
      }
      return undefined
    })

    renderWithProviders(<ReportsPage />, { authenticated: true })

    await waitFor(() => expect(screen.getByText('Không có dữ liệu trong khoảng ngày đã chọn.')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('refetches with the selected employee_id when the employee filter changes', async () => {
    const requestedEmployeeIds: Array<string | null> = []
    mockApi(({ method, pathname, search }) => {
      if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees: EMPLOYEES } }
      if (method === 'GET' && pathname === '/api/reports/payroll') {
        requestedEmployeeIds.push(search.get('employee_id'))
        return { status: 200, body: { report: baseReport() } }
      }
      return undefined
    })

    renderWithProviders(<ReportsPage />, { authenticated: true })
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByLabelText('Nhân viên')).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('Nhân viên'), 'emp-2')

    await waitFor(() => expect(requestedEmployeeIds).toContain('emp-2'))
  })

  it('exports a CSV by fetching the export endpoint and triggering a download', async () => {
    // jsdom doesn't implement these -- stub in place rather than replacing
    // the global URL constructor, which fetchMock's `new URL(...)` needs.
    const createObjectURL = vi.fn(() => 'blob:mock-url')
    const revokeObjectURL = vi.fn()
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL

    let requestedFrom: string | null = null
    let exportPath: string | null = null
    mockApi(({ method, pathname, search }) => {
      if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees: EMPLOYEES } }
      if (method === 'GET' && pathname === '/api/reports/payroll') {
        requestedFrom = search.get('from')
        return { status: 200, body: { report: baseReport() } }
      }
      if (method === 'GET' && pathname === '/api/reports/payroll/export') {
        exportPath = `${pathname}?${search.toString()}`
        return { status: 200, body: 'csv,content' }
      }
      return undefined
    })

    renderWithProviders(<ReportsPage />, { authenticated: true })
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Xuất CSV' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Xuất CSV' }))

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled())
    expect(exportPath).toContain('format=csv')
    expect(exportPath).toContain(`from=${requestedFrom}`)
  })
})
