import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders the app title', () => {
    render(<App />)
    expect(screen.getByText('Chấm Công')).toBeInTheDocument()
  })

  it('renders the subtitle', () => {
    render(<App />)
    expect(
      screen.getByText('Hệ thống Chấm công & Tính lương Partime tự động'),
    ).toBeInTheDocument()
  })
})
