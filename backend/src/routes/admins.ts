import { Response, Router } from 'express'
import { AuthenticatedRequest, authenticate } from '../middleware/authenticate'
import { prisma } from '../lib/db'
import { hashPassword } from '../lib/password'

const router = Router()

router.use(authenticate)

router.get('/admins', async (_req: AuthenticatedRequest, res: Response) => {
  const admins = await prisma.admin.findMany({
    select: { id: true, email: true, name: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  res.status(200).json({ admins })
})

router.post('/admins', async (req: AuthenticatedRequest, res: Response) => {
  const { email, password, name } = req.body ?? {}

  if (
    typeof email !== 'string' ||
    typeof password !== 'string' ||
    typeof name !== 'string' ||
    !email ||
    !password ||
    !name
  ) {
    res.status(400).json({ error: 'email, password and name are required' })
    return
  }

  const existing = await prisma.admin.findUnique({ where: { email } })
  if (existing) {
    res.status(409).json({ error: 'Email already in use' })
    return
  }

  const passwordHash = await hashPassword(password)
  const admin = await prisma.admin.create({
    data: { email, passwordHash, name },
    select: { id: true, email: true, name: true, createdAt: true },
  })

  res.status(201).json({ admin })
})

router.delete('/admins/:id', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params

  const target = await prisma.admin.findUnique({ where: { id } })
  if (!target) {
    res.status(404).json({ error: 'Admin not found' })
    return
  }

  const totalAdmins = await prisma.admin.count()
  if (totalAdmins <= 1) {
    res.status(409).json({ error: 'Cannot delete the last remaining admin' })
    return
  }

  await prisma.admin.delete({ where: { id } })
  res.status(204).send()
})

router.patch('/admins/:id/password', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params
  const { password } = req.body ?? {}

  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'password must be a string of at least 8 characters' })
    return
  }

  const target = await prisma.admin.findUnique({ where: { id } })
  if (!target) {
    res.status(404).json({ error: 'Admin not found' })
    return
  }

  const passwordHash = await hashPassword(password)
  await prisma.admin.update({ where: { id }, data: { passwordHash } })
  res.status(200).json({ ok: true })
})

export default router
