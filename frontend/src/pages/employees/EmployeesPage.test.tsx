import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmployeesPage } from './EmployeesPage'
import { mockApi } from '../../test-utils/fetchMock'
import { renderWithProviders } from '../../test-utils/renderWithProviders'

function baseEmployee(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'emp-1',
    externalId: null,
    name: 'Nguyễn Văn A',
    phone: null,
    source: 'manual',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('EmployeesPage', () => {
  it('tạo nhân viên qua form → xuất hiện trong danh sách ngay', async () => {
    let created: ReturnType<typeof baseEmployee> | null = null
    mockApi(({ method, pathname, body }) => {
      if (method === 'GET' && pathname === '/api/employees') {
        return { status: 200, body: { employees: created ? [created] : [] } }
      }
      if (method === 'POST' && pathname === '/api/employees') {
        const { name, phone } = body as { name: string; phone: string | null }
        created = baseEmployee({ id: 'emp-new', name, phone })
        return { status: 201, body: { employee: created } }
      }
      return undefined
    })

    renderWithProviders(<EmployeesPage />, { authenticated: true })
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Thêm nhân viên' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Thêm nhân viên' }))
    await user.type(screen.getByLabelText('Tên'), 'Lê Văn C')
    await user.click(screen.getByRole('button', { name: 'Thêm' }))

    await waitFor(() => expect(screen.getByText('Lê Văn C')).toBeInTheDocument())
  })

  it('sửa tên nhân viên → cập nhật hiển thị ngay không cần reload thủ công', async () => {
    const employee = baseEmployee()
    mockApi(({ method, pathname, body }) => {
      if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees: [employee] } }
      if (method === 'PATCH' && pathname === `/api/employees/${employee.id}`) {
        const { name } = body as { name: string }
        return { status: 200, body: { employee: { ...employee, name } } }
      }
      return undefined
    })

    renderWithProviders(<EmployeesPage />, { authenticated: true })
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Sửa' }))

    const nameInput = screen.getByLabelText('Tên')
    await user.clear(nameInput)
    await user.type(nameInput, 'Nguyễn Văn A (đã sửa)')
    await user.click(screen.getByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(screen.getByText('Nguyễn Văn A (đã sửa)')).toBeInTheDocument())
  })

  it('vô hiệu hoá nhân viên → biến khỏi filter "đang hoạt động" nhưng còn trong filter "tất cả"', async () => {
    const employee = baseEmployee()
    mockApi(({ method, pathname }) => {
      if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees: [employee] } }
      if (method === 'DELETE' && pathname === `/api/employees/${employee.id}`) {
        return { status: 200, body: { employee: { ...employee, active: false } } }
      }
      return undefined
    })

    renderWithProviders(<EmployeesPage />, { authenticated: true })
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Vô hiệu hoá' }))

    await waitFor(() => expect(screen.queryByText('Nguyễn Văn A')).not.toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('Trạng thái'), 'all')
    const row = screen.getByText('Nguyễn Văn A').closest('tr')!
    expect(within(row).getByText('Đã vô hiệu hoá')).toBeInTheDocument()
  })

  it('thao tác link external_id thành công hiển thị rõ nhân viên đã "đã đồng bộ"', async () => {
    const employee = baseEmployee()
    mockApi(({ method, pathname, body }) => {
      if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees: [employee] } }
      if (method === 'PATCH' && pathname === `/api/employees/${employee.id}/link-external`) {
        const { external_id: externalId } = body as { external_id: string }
        return { status: 200, body: { employee: { ...employee, externalId } } }
      }
      return undefined
    })

    renderWithProviders(<EmployeesPage />, { authenticated: true })
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByText('Thủ công')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Liên kết mã NV' }))
    await user.type(screen.getByLabelText('Mã nhân viên (external_id)'), 'ext-123')

    const row = screen.getByText('Nguyễn Văn A').closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Liên kết' }))

    await waitFor(() => expect(screen.getByText('Đã đồng bộ')).toBeInTheDocument())
  })
})
