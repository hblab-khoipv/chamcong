import express, { Application, Request, Response, NextFunction } from 'express'
import healthRouter from './routes/health'
import authRouter from './routes/auth'
import adminsRouter from './routes/admins'
import employeesRouter from './routes/employees'
import rateBandsRouter from './routes/rateBands'
import holidaysRouter from './routes/holidays'

export function createApp(): Application {
  const app = express()

  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true }))

  app.use(healthRouter)
  app.use(authRouter)
  app.use(adminsRouter)
  app.use(employeesRouter)
  app.use(rateBandsRouter)
  app.use(holidaysRouter)

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
