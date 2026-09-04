import '@testing-library/jest-dom'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
