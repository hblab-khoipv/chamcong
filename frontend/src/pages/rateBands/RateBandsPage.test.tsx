import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RateBandsPage } from './RateBandsPage'
import { mockApi } from '../../test-utils/fetchMock'
import { renderWithProviders } from '../../test-utils/renderWithProviders'

function band(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'band-1',
    name: 'Ca sáng',
    startTime: '06:00',
    endTime: '17:00',
    ratePerHourVnd: 25000,
    durationHours: 11,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('RateBandsPage', () => {
  it('thêm band hợp lệ → hiển thị đúng trên timeline', async () => {
    let bands = [band()]
    mockApi(({ method, pathname, body }) => {
      if (method === 'GET' && pathname === '/api/rate-bands') return { status: 200, body: { rateBands: bands } }
      if (method === 'GET' && pathname === '/api/rate-bands/coverage') {
        return { status: 200, body: { bands, gaps: [{ startTime: '17:00', endTime: '06:00' }] } }
      }
      if (method === 'POST' && pathname === '/api/rate-bands') {
        const input = body as { name: string; start_time: string; end_time: string; rate_per_hour_vnd: number }
        const newBand = band({
          id: 'band-2',
          name: input.name,
          startTime: input.start_time,
          endTime: input.end_time,
          ratePerHourVnd: input.rate_per_hour_vnd,
        })
        bands = [...bands, newBand]
        return { status: 201, body: { rateBand: newBand } }
      }
      return undefined
    })

    renderWithProviders(<RateBandsPage />, { authenticated: true })
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Thêm khung giờ' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Thêm khung giờ' }))

    await user.type(screen.getByLabelText('Tên'), 'Ca tối')
    const startInput = screen.getByLabelText('Giờ bắt đầu') as HTMLInputElement
    const endInput = screen.getByLabelText('Giờ kết thúc') as HTMLInputElement
    await user.clear(startInput)
    await user.type(startInput, '17:00')
    await user.clear(endInput)
    await user.type(endInput, '00:00')
    await user.type(screen.getByLabelText('Đơn giá (VNĐ/giờ)'), '30000')
    await user.click(screen.getByRole('button', { name: 'Thêm' }))

    await waitFor(() => expect(screen.getByText(/Ca tối \(17:00-00:00\)/)).toBeInTheDocument())
  })

  it('thêm band chồng giờ → form hiển thị lỗi, band không được thêm vào danh sách', async () => {
    const bands = [band()]
    mockApi(({ method, pathname }) => {
      if (method === 'GET' && pathname === '/api/rate-bands') return { status: 200, body: { rateBands: bands } }
      if (method === 'GET' && pathname === '/api/rate-bands/coverage') {
        return { status: 200, body: { bands, gaps: [] } }
      }
      if (method === 'POST' && pathname === '/api/rate-bands') {
        return { status: 409, body: { error: 'Rate band overlaps with "Ca sáng" (08:00-18:00 conflicts with existing band)' } }
      }
      return undefined
    })

    renderWithProviders(<RateBandsPage />, { authenticated: true })
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Thêm khung giờ' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Thêm khung giờ' }))

    await user.type(screen.getByLabelText('Tên'), 'Ca chồng giờ')
    const startInput = screen.getByLabelText('Giờ bắt đầu')
    const endInput = screen.getByLabelText('Giờ kết thúc')
    await user.clear(startInput)
    await user.type(startInput, '08:00')
    await user.clear(endInput)
    await user.type(endInput, '18:00')
    await user.type(screen.getByLabelText('Đơn giá (VNĐ/giờ)'), '20000')
    await user.click(screen.getByRole('button', { name: 'Thêm' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/overlaps with "Ca sáng"/)
    expect(screen.queryByText('Ca chồng giờ')).not.toBeInTheDocument()
  })
})
