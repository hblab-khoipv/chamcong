import express, { Application, Request, Response, NextFunction } from 'express'
import healthRouter from './routes/health'
import authRouter from './routes/auth'
import adminsRouter from './routes/admins'
import employeesRouter from './routes/employees'
import rateBandsRouter from './routes/rateBands'
import holidaysRouter from './routes/holidays'
import webhooksRouter from './routes/webhooks'
import attendanceEventsRouter from './routes/attendanceEvents'
import attendanceSessionsRouter from './routes/attendanceSessions'

export function createApp(): Application {
  const app = express()

  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true }))

  // webhooksRouter is intentionally unauthenticated (T6) and MUST be
  // mounted before any router.use(authenticate)-guarded router below: each
  // of those routers is mounted at "/" with no path prefix, so it receives
  // every request regardless of path, and its unconditional authenticate
  // middleware would 401 a request before it ever reaches a later router.
  app.use(healthRouter)
  app.use(authRouter)
  app.use(webhooksRouter)
  app.use(adminsRouter)
  app.use(employeesRouter)
  app.use(rateBandsRouter)
  app.use(holidaysRouter)
  app.use(attendanceEventsRouter)
  app.use(attendanceSessionsRouter)

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
