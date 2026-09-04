import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HolidaysPage } from './HolidaysPage'
import { mockApi } from '../../test-utils/fetchMock'
import { renderWithProviders } from '../../test-utils/renderWithProviders'

function holiday(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'hol-1',
    holidayDate: '2026-01-01',
    name: 'Tết Dương lịch',
    rateType: 'PERCENT',
    rateValue: 200,
    active: true,
    createdAt: '2025-12-01T00:00:00.000Z',
    updatedAt: '2025-12-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('HolidaysPage', () => {
  it('thêm ngày lễ mới → xuất hiện đúng vị trí trên lịch mini', async () => {
    let holidays = [holiday()]
    mockApi(({ method, pathname, body }) => {
      if (method === 'GET' && pathname === '/api/holidays') return { status: 200, body: { holidays } }
      if (method === 'POST' && pathname === '/api/holidays') {
        const input = body as { holiday_date: string; name: string; rate_type: 'PERCENT' | 'FIXED'; rate_value: number }
        const existing = holidays.find((h) => h.holidayDate === input.holiday_date)
        if (existing) return { status: 409, body: { error: 'A holiday already exists for this date' } }
        const created = holiday({ id: 'hol-2', holidayDate: input.holiday_date, name: input.name, rateType: input.rate_type, rateValue: input.rate_value })
        holidays = [...holidays, created]
        return { status: 201, body: { holiday: created } }
      }
      return undefined
    })

    renderWithProviders(<HolidaysPage />, { authenticated: true })
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Thêm ngày lễ' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Thêm ngày lễ' }))

    await user.type(screen.getByLabelText('Ngày'), '2026-04-30')
    await user.type(screen.getByLabelText('Tên ngày lễ'), 'Giải phóng miền Nam')
    await user.selectOptions(screen.getByLabelText('Loại đơn giá'), 'PERCENT')
    await user.type(screen.getByLabelText('Hệ số (%)'), '200')
    await user.click(screen.getByRole('button', { name: 'Thêm' }))

    await waitFor(() => expect(screen.getByTestId('holiday-day-2026-04-30')).toBeInTheDocument())
    expect(screen.getByTestId('holiday-day-2026-04-30')).toHaveAttribute('title', 'Giải phóng miền Nam')
  })

  it('thêm ngày lễ trùng ngày đã có → hiển thị lỗi từ API', async () => {
    const holidays = [holiday()]
    mockApi(({ method, pathname }) => {
      if (method === 'GET' && pathname === '/api/holidays') return { status: 200, body: { holidays } }
      if (method === 'POST' && pathname === '/api/holidays') {
        return { status: 409, body: { error: 'A holiday already exists for this date' } }
      }
      return undefined
    })

    renderWithProviders(<HolidaysPage />, { authenticated: true })
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Thêm ngày lễ' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Thêm ngày lễ' }))

    await user.type(screen.getByLabelText('Ngày'), '2026-01-01')
    await user.type(screen.getByLabelText('Tên ngày lễ'), 'Trùng ngày')
    await user.selectOptions(screen.getByLabelText('Loại đơn giá'), 'PERCENT')
    await user.type(screen.getByLabelText('Hệ số (%)'), '200')
    await user.click(screen.getByRole('button', { name: 'Thêm' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('A holiday already exists for this date')
  })

  it('xoá ngày lễ → biến mất khỏi lịch mini ngay', async () => {
    const hol = holiday()
    mockApi(({ method, pathname }) => {
      if (method === 'GET' && pathname === '/api/holidays') return { status: 200, body: { holidays: [hol] } }
      if (method === 'DELETE' && pathname === `/api/holidays/${hol.id}`) {
        return { status: 200, body: { holiday: { ...hol, active: false } } }
      }
      return undefined
    })

    renderWithProviders(<HolidaysPage />, { authenticated: true })
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByTestId('holiday-day-2026-01-01')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Xoá' }))

    await waitFor(() => expect(screen.queryByTestId('holiday-day-2026-01-01')).not.toBeInTheDocument())
  })
})
