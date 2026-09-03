import { createApp } from './app'
import { disconnectDb } from './lib/db'

const PORT = parseInt(process.env.PORT ?? '3000', 10)

const app = createApp()

const server = app.listen(PORT, () => {
  console.log(`[chamcong] Server running on port ${PORT}`)
  console.log(`[chamcong] Health: http://localhost:${PORT}/health`)
})

process.on('SIGTERM', async () => {
  console.log('[chamcong] SIGTERM received, shutting down...')
  server.close(async () => {
    await disconnectDb()
    process.exit(0)
  })
})

process.on('SIGINT', async () => {
  console.log('[chamcong] SIGINT received, shutting down...')
  server.close(async () => {
    await disconnectDb()
    process.exit(0)
  })
})
