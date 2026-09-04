import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

describe('App', () => {
  it('redirects an unauthenticated visitor to the login page', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>
    )
    expect(screen.getByRole('heading', { name: 'Chấm Công — Đăng nhập Admin' })).toBeInTheDocument()
  })
})
