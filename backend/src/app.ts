import express, { Application, Request, Response, NextFunction } from 'express'
import healthRouter from './routes/health'

export function createApp(): Application {
  const app = express()

  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true }))

  app.use(healthRouter)

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' })
  })

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err.stack)
    res.status(500).json({ error: 'Internal server error' })
  })

  return app
}
