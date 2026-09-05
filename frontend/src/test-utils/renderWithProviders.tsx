import { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../auth/AuthContext'

const TOKEN_STORAGE_KEY = 'chamcong_admin_token'

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', authenticated = false }: { route?: string; authenticated?: boolean } = {}
) {
  if (authenticated) {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'test-token')
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
  }

  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>
  )
}
