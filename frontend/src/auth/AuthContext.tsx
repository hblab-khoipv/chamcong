import { ReactNode, createContext, useContext, useMemo, useState } from 'react'
import { authApi } from '../api/endpoints'
import { setAuthToken } from '../api/client'

const TOKEN_STORAGE_KEY = 'chamcong_admin_token'

interface AuthContextValue {
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY)
    setAuthToken(stored)
    return stored
  })

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: token !== null,
      login: async (email: string, password: string) => {
        const { token: newToken } = await authApi.login(email, password)
        localStorage.setItem(TOKEN_STORAGE_KEY, newToken)
        setAuthToken(newToken)
        setToken(newToken)
      },
      logout: () => {
        localStorage.removeItem(TOKEN_STORAGE_KEY)
        setAuthToken(null)
        setToken(null)
      },
    }),
    [token]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
