import { NextFunction, Request, Response } from 'express'
import { verifyAdminToken } from '../lib/jwt'

export interface AuthenticatedRequest extends Request {
  admin?: { id: string; email: string }
}

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization

  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const token = header.slice('Bearer '.length)

  try {
    const payload = verifyAdminToken(token)
    req.admin = { id: payload.sub, email: payload.email }
    next()
  } catch {
    res.status(401).json({ error: 'Unauthorized' })
  }
}
