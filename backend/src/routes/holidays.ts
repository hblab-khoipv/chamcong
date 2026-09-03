import { Holiday, Prisma } from '@prisma/client'
import { Response, Router } from 'express'
import { AuthenticatedRequest, authenticate } from '../middleware/authenticate'
import { prisma } from '../lib/db'

const router = Router()

router.use(authenticate)

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

function parseHolidayDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !DATE_REGEX.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function serializeHoliday(holiday: Holiday) {
  return {
    id: holiday.id,
    holidayDate: holiday.holidayDate.toISOString().slice(0, 10),
    name: holiday.name,
    rateType: holiday.rateType,
    rateValue: Number(holiday.rateValue),
    active: holiday.active,
    createdAt: holiday.createdAt,
    updatedAt: holiday.updatedAt,
  }
}

function validateRateFields(rateType: unknown, rateValue: unknown): string | null {
  if (rateType !== 'PERCENT' && rateType !== 'FIXED') {
    return 'rate_type must be PERCENT or FIXED'
  }
  if (typeof rateValue !== 'number' || !Number.isFinite(rateValue) || rateValue <= 0) {
    return 'rate_value must be a positive number'
  }
  return null
}

router.get('/holidays', async (req: AuthenticatedRequest, res: Response) => {
  const { year } = req.query

  const where: Prisma.HolidayWhereInput = {}
  if (typeof year === 'string' && /^\d{4}$/.test(year)) {
    const y = Number(year)
    where.holidayDate = { gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) }
  }

  const holidays = await prisma.holiday.findMany({ where, orderBy: { holidayDate: 'asc' } })
  res.status(200).json({ holidays: holidays.map(serializeHoliday) })
})

router.post('/holidays', async (req: AuthenticatedRequest, res: Response) => {
  const { holiday_date: dateStr, name, rate_type: rateType, rate_value: rateValue } = req.body ?? {}

  const holidayDate = parseHolidayDate(dateStr)
  if (!holidayDate) {
    res.status(400).json({ error: 'holiday_date must be a YYYY-MM-DD string' })
    return
  }
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const rateError = validateRateFields(rateType, rateValue)
  if (rateError) {
    res.status(400).json({ error: rateError })
    return
  }

  const existing = await prisma.holiday.findUnique({ where: { holidayDate } })
  if (existing) {
    res.status(409).json({ error: 'A holiday already exists for this date' })
    return
  }

  const holiday = await prisma.holiday.create({
    data: { holidayDate, name: name.trim(), rateType, rateValue },
  })
  res.status(201).json({ holiday: serializeHoliday(holiday) })
})

router.patch('/holidays/:id', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params
  const existing = await prisma.holiday.findUnique({ where: { id } })
  if (!existing) {
    res.status(404).json({ error: 'Holiday not found' })
    return
  }

  const { holiday_date: dateStr, name, rate_type: rateType, rate_value: rateValue, active } = req.body ?? {}
  const data: Prisma.HolidayUpdateInput = {}

  if (dateStr !== undefined) {
    const holidayDate = parseHolidayDate(dateStr)
    if (!holidayDate) {
      res.status(400).json({ error: 'holiday_date must be a YYYY-MM-DD string' })
      return
    }
    const conflict = await prisma.holiday.findUnique({ where: { holidayDate } })
    if (conflict && conflict.id !== id) {
      res.status(409).json({ error: 'A holiday already exists for this date' })
      return
    }
    data.holidayDate = holidayDate
  }

  if (typeof name === 'string' && name.trim()) data.name = name.trim()

  if (rateType !== undefined || rateValue !== undefined) {
    const nextRateType = rateType ?? existing.rateType
    const nextRateValue = rateValue ?? Number(existing.rateValue)
    const rateError = validateRateFields(nextRateType, nextRateValue)
    if (rateError) {
      res.status(400).json({ error: rateError })
      return
    }
    data.rateType = nextRateType
    data.rateValue = nextRateValue
  }

  if (typeof active === 'boolean') data.active = active

  const holiday = await prisma.holiday.update({ where: { id }, data })
  res.status(200).json({ holiday: serializeHoliday(holiday) })
})

// Always soft-delete (deactivate): historical attendance segments freeze
// their own rate_applied_vnd/amount_vnd at compute time (T9), so
// deactivating a holiday never rewrites past numbers — it only stops the
// holiday rate from applying to sessions computed after this point (T5
// acceptance criteria).
router.delete('/holidays/:id', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params
  const existing = await prisma.holiday.findUnique({ where: { id } })
  if (!existing) {
    res.status(404).json({ error: 'Holiday not found' })
    return
  }

  const holiday = await prisma.holiday.update({ where: { id }, data: { active: false } })
  res.status(200).json({ holiday: serializeHoliday(holiday) })
})

export default router
