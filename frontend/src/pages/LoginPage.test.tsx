import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'
import { mockApi } from '../test-utils/fetchMock'

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <App />
    </MemoryRouter>
  )
}

describe('LoginPage', () => {
  it('đăng nhập đúng → chuyển vào dashboard', async () => {
    mockApi(({ method, pathname, body }) => {
      if (method === 'POST' && pathname === '/api/auth/login') {
        const { email, password } = body as { email: string; password: string }
        if (email === 'admin@chamcong.local' && password === 'correct-password') {
          return { status: 200, body: { token: 'fake-jwt-token' } }
        }
        return { status: 401, body: { error: 'Invalid email or password' } }
      }
      if (method === 'GET' && pathname === '/api/employees') return { status: 200, body: { employees: [] } }
      if (method === 'GET' && pathname === '/api/attendance-sessions') {
        return { status: 200, body: { attendanceSessions: [] } }
      }
      if (method === 'GET' && pathname === '/api/attendance-events/unmatched') {
        return { status: 200, body: { attendanceEvents: [] } }
      }
      return undefined
    })

    renderApp()
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Email'), 'admin@chamcong.local')
    await user.type(screen.getByLabelText('Mật khẩu'), 'correct-password')
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Tổng quan' })).toBeInTheDocument())
  })

  it('đăng nhập sai → hiện thông báo lỗi, ở lại trang login', async () => {
    mockApi(({ method, pathname }) => {
      if (method === 'POST' && pathname === '/api/auth/login') {
        return { status: 401, body: { error: 'Invalid email or password' } }
      }
      return undefined
    })

    renderApp()
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Email'), 'admin@chamcong.local')
    await user.type(screen.getByLabelText('Mật khẩu'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
    expect(screen.getByRole('heading', { name: 'Chấm Công — Đăng nhập Admin' })).toBeInTheDocument()
  })
})
