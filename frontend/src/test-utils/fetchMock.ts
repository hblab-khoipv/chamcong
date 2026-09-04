import { vi } from 'vitest'

interface HandlerContext {
  method: string
  pathname: string
  search: URLSearchParams
  body: unknown
}

type Handler = (ctx: HandlerContext) => { status: number; body?: unknown } | undefined

// Minimal route-dispatch fetch mock shared across page tests: each test
// supplies a handler function that pattern-matches on method/pathname and
// returns a fixture response, mirroring the backend's actual JSON shapes.
export function mockApi(handler: Handler) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const urlStr = typeof input === 'string' ? input : String(input)
    const url = new URL(urlStr, 'http://localhost')
    const method = (init.method ?? 'GET').toUpperCase()
    const body = init.body ? JSON.parse(init.body as string) : undefined

    const result = handler({ method, pathname: url.pathname, search: url.searchParams, body })
    if (!result) {
      return new Response(JSON.stringify({ error: `Unhandled ${method} ${url.pathname}` }), { status: 404 })
    }
    return new Response(result.body !== undefined ? JSON.stringify(result.body) : null, { status: result.status })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
