import { Request, Response, Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { isLocked, recordFailure, resetAttempts } from '../middleware/loginRateLimit'
import { prisma } from '../lib/db'
import { signAdminToken } from '../lib/jwt'
import { verifyPassword } from '../lib/password'

const router = Router()

router.post('/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {}

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    res.status(400).json({ error: 'email and password are required' })
    return
  }

  if (isLocked(email)) {
    res.status(429).json({ error: 'Too many failed login attempts. Try again later.' })
    return
  }

  const admin = await prisma.admin.findUnique({ where: { email } })

  if (!admin) {
    recordFailure(email)
    res.status(401).json({ error: 'Invalid email or password' })
    return
  }

  const valid = await verifyPassword(password, admin.passwordHash)

  if (!valid) {
    recordFailure(email)
    res.status(401).json({ error: 'Invalid email or password' })
    return
  }

  resetAttempts(email)
  const token = signAdminToken({ sub: admin.id, email: admin.email })
  res.status(200).json({ token })
})

router.post('/auth/logout', authenticate, (_req: Request, res: Response) => {
  // JWTs are stateless in this design (no server-side session/blacklist), so
  // logout is a formality endpoint: the client discards its token. Changing
  // a password (below) is what actually invalidates prior credentials.
  res.status(200).json({ ok: true })
})

export default router
