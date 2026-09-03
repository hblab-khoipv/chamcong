import { Router, Request, Response } from 'express'
import { checkDbConnection } from '../lib/db'

const router = Router()

const VERSION = '0.1.0'

router.get('/health', async (_req: Request, res: Response) => {
  const dbConnected = await checkDbConnection()

  res.status(200).json({
    status: 'ok',
    version: VERSION,
    timestamp: new Date().toISOString(),
    db_connected: dbConnected,
  })
})

export default router
