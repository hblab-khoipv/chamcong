// Thin fetch wrapper for the backend REST API. Requests go through Vite's
// dev proxy at /api -> http://localhost:3000 (see vite.config.ts), which
// strips the /api prefix before forwarding.
const BASE_URL = '/api'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

let authToken: string | null = null

export function setAuthToken(token: string | null): void {
  authToken = token
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  }

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })

  const text = await res.text()
  const data = text ? JSON.parse(text) : null

  if (!res.ok) {
    const message =
      data && typeof data.error === 'string' ? data.error : `Request failed with status ${res.status}`
    throw new ApiError(res.status, message)
  }

  return data as T
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' })
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) })
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' })
}

// For binary downloads (T16 payroll export) -- the standard `request()`
// helper above always parses the response as JSON, which a CSV/xlsx body
// isn't.
export async function apiGetBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {}
  if (authToken) headers.Authorization = `Bearer ${authToken}`

  const res = await fetch(`${BASE_URL}${path}`, { method: 'GET', headers })

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`
    try {
      const data = await res.json()
      if (data && typeof data.error === 'string') message = data.error
    } catch {
      // response wasn't JSON -- keep the generic message
    }
    throw new ApiError(res.status, message)
  }

  return res.blob()
}
