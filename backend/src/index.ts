import { createApp } from './app'
import { disconnectDb } from './lib/db'
import { flagStaleOpenSessions } from './lib/attendanceSession'

const PORT = parseInt(process.env.PORT ?? '3000', 10)
// T8 item 3: periodic sweep for OPEN sessions stuck past the stale
// threshold (default 16h, see AGENTS.md / lib/config.ts).
const STALE_SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000

const app = createApp()

const server = app.listen(PORT, () => {
  console.log(`[chamcong] Server running on port ${PORT}`)
  console.log(`[chamcong] Health: http://localhost:${PORT}/health`)
})

const staleSessionSweep = setInterval(() => {
  flagStaleOpenSessions().catch((err) => {
    console.error('[chamcong] stale session sweep failed:', err)
  })
}, STALE_SESSION_SWEEP_INTERVAL_MS)

process.on('SIGTERM', async () => {
  console.log('[chamcong] SIGTERM received, shutting down...')
  clearInterval(staleSessionSweep)
  server.close(async () => {
    await disconnectDb()
    process.exit(0)
  })
})

process.on('SIGINT', async () => {
  console.log('[chamcong] SIGINT received, shutting down...')
  clearInterval(staleSessionSweep)
  server.close(async () => {
    await disconnectDb()
    process.exit(0)
  })
})
