import { Prisma } from '@prisma/client'
import { Response, Router } from 'express'
import { AuthenticatedRequest, authenticate } from '../middleware/authenticate'
import { prisma } from '../lib/db'

const router = Router()

router.use(authenticate)

router.get('/employees', async (req: AuthenticatedRequest, res: Response) => {
  const { source, active, name } = req.query

  const where: Prisma.EmployeeWhereInput = {}

  if (source === 'synced' || source === 'manual') {
    where.source = source
  }

  if (active === 'true') {
    where.active = true
  } else if (active === 'false') {
    where.active = false
  }

  if (typeof name === 'string' && name.trim() !== '') {
    where.name = { contains: name.trim(), mode: 'insensitive' }
  }

  const employees = await prisma.employee.findMany({ where, orderBy: { createdAt: 'asc' } })
  res.status(200).json({ employees })
})

router.post('/employees', async (req: AuthenticatedRequest, res: Response) => {
  const { name, phone } = req.body ?? {}

  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const employee = await prisma.employee.create({
    data: {
      name: name.trim(),
      phone: typeof phone === 'string' ? phone : null,
      source: 'manual',
      externalId: null,
    },
  })

  res.status(201).json({ employee })
})

router.patch('/employees/:id', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params
  const { name, phone, active } = req.body ?? {}

  const existing = await prisma.employee.findUnique({ where: { id } })
  if (!existing) {
    res.status(404).json({ error: 'Employee not found' })
    return
  }

  const data: Prisma.EmployeeUpdateInput = {}
  if (typeof name === 'string' && name.trim()) data.name = name.trim()
  if (typeof phone === 'string' || phone === null) data.phone = phone
  if (typeof active === 'boolean') data.active = active

  const employee = await prisma.employee.update({ where: { id }, data })
  res.status(200).json({ employee })
})

// Soft-delete: sets active=false. Attendance history referencing this
// employee stays intact and queryable (T3 acceptance criteria).
router.delete('/employees/:id', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params

  const existing = await prisma.employee.findUnique({ where: { id } })
  if (!existing) {
    res.status(404).json({ error: 'Employee not found' })
    return
  }

  const employee = await prisma.employee.update({ where: { id }, data: { active: false } })
  res.status(200).json({ employee })
})

router.patch('/employees/:id/link-external', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params
  const { external_id: externalId } = req.body ?? {}

  if (typeof externalId !== 'string' || !externalId.trim()) {
    res.status(400).json({ error: 'external_id is required' })
    return
  }
  const trimmedExternalId = externalId.trim()

  const existing = await prisma.employee.findUnique({ where: { id } })
  if (!existing) {
    res.status(404).json({ error: 'Employee not found' })
    return
  }

  const conflict = await prisma.employee.findUnique({ where: { externalId: trimmedExternalId } })
  if (conflict && conflict.id !== id) {
    res.status(409).json({ error: 'external_id already linked to another employee' })
    return
  }

  const employee = await prisma.employee.update({
    where: { id },
    data: { externalId: trimmedExternalId },
  })

  res.status(200).json({ employee })
})

export default router
