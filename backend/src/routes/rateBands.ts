import { Prisma, RateBand } from '@prisma/client'
import { Response, Router } from 'express'
import { AuthenticatedRequest, authenticate } from '../middleware/authenticate'
import { prisma } from '../lib/db'
import {
  bandDurationHours,
  computeGaps,
  findOverlappingBand,
  formatMinutes,
  formatTimeString,
  parseTimeString,
  toMinutes,
} from '../lib/timeOfDay'

const router = Router()

router.use(authenticate)

function serializeRateBand(band: RateBand) {
  const startMinutes = toMinutes(band.startTime)
  const endMinutes = toMinutes(band.endTime)
  return {
    id: band.id,
    name: band.name,
    startTime: formatTimeString(band.startTime),
    endTime: formatTimeString(band.endTime),
    ratePerHourVnd: band.ratePerHourVnd,
    durationHours: bandDurationHours(startMinutes, endMinutes),
    active: band.active,
    createdAt: band.createdAt,
    updatedAt: band.updatedAt,
  }
}

async function findConflict(
  candidate: { startMinutes: number; endMinutes: number },
  excludeId?: string
): Promise<{ id: string; name: string } | null> {
  const activeBands = await prisma.rateBand.findMany({
    where: { active: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
  })
  return findOverlappingBand(
    candidate,
    activeBands.map((b) => ({ id: b.id, name: b.name, startMinutes: toMinutes(b.startTime), endMinutes: toMinutes(b.endTime) }))
  )
}

router.get('/rate-bands', async (req: AuthenticatedRequest, res: Response) => {
  const { active } = req.query

  const where: Prisma.RateBandWhereInput = {}
  if (active === 'true') where.active = true
  else if (active === 'false') where.active = false

  const bands = await prisma.rateBand.findMany({ where, orderBy: { startTime: 'asc' } })
  res.status(200).json({ rateBands: bands.map(serializeRateBand) })
})

// T4 item 5: 24h coverage map — which active band covers which window, and
// any gaps not covered by an active band.
router.get('/rate-bands/coverage', async (_req: AuthenticatedRequest, res: Response) => {
  const bands = await prisma.rateBand.findMany({ where: { active: true } })
  const ranges = bands
    .map((b) => ({ band: b, startMinutes: toMinutes(b.startTime), endMinutes: toMinutes(b.endTime) }))
    .sort((a, b) => a.startMinutes - b.startMinutes)

  const gaps = computeGaps(ranges).map(([start, end]) => ({
    startTime: formatMinutes(start),
    endTime: formatMinutes(end),
  }))

  res.status(200).json({
    bands: ranges.map((r) => serializeRateBand(r.band)),
    gaps,
  })
})

router.post('/rate-bands', async (req: AuthenticatedRequest, res: Response) => {
  const { name, start_time: startTimeStr, end_time: endTimeStr, rate_per_hour_vnd: rate } = req.body ?? {}

  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const startTime = parseTimeString(startTimeStr)
  const endTime = parseTimeString(endTimeStr)
  if (!startTime || !endTime) {
    res.status(400).json({ error: 'start_time and end_time must be HH:MM strings' })
    return
  }

  if (!Number.isInteger(rate) || rate <= 0) {
    res.status(400).json({ error: 'rate_per_hour_vnd must be a positive integer' })
    return
  }

  const conflict = await findConflict({ startMinutes: toMinutes(startTime), endMinutes: toMinutes(endTime) })
  if (conflict) {
    res.status(409).json({
      error: `Rate band overlaps with "${conflict.name}" (${formatTimeString(startTime)}-${formatTimeString(endTime)} conflicts with existing band)`,
    })
    return
  }

  const band = await prisma.rateBand.create({
    data: { name: name.trim(), startTime, endTime, ratePerHourVnd: rate },
  })
  res.status(201).json({ rateBand: serializeRateBand(band) })
})

router.patch('/rate-bands/:id', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params
  const existing = await prisma.rateBand.findUnique({ where: { id } })
  if (!existing) {
    res.status(404).json({ error: 'Rate band not found' })
    return
  }

  const { name, start_time: startTimeStr, end_time: endTimeStr, rate_per_hour_vnd: rate, active } = req.body ?? {}

  const data: Prisma.RateBandUpdateInput = {}
  if (typeof name === 'string' && name.trim()) data.name = name.trim()

  let startTime = existing.startTime
  if (startTimeStr !== undefined) {
    const parsed = parseTimeString(startTimeStr)
    if (!parsed) {
      res.status(400).json({ error: 'start_time must be an HH:MM string' })
      return
    }
    startTime = parsed
    data.startTime = parsed
  }

  let endTime = existing.endTime
  if (endTimeStr !== undefined) {
    const parsed = parseTimeString(endTimeStr)
    if (!parsed) {
      res.status(400).json({ error: 'end_time must be an HH:MM string' })
      return
    }
    endTime = parsed
    data.endTime = parsed
  }

  if (rate !== undefined) {
    if (!Number.isInteger(rate) || rate <= 0) {
      res.status(400).json({ error: 'rate_per_hour_vnd must be a positive integer' })
      return
    }
    data.ratePerHourVnd = rate
  }

  const nextActive = typeof active === 'boolean' ? active : existing.active
  if (typeof active === 'boolean') data.active = active

  if (nextActive) {
    const conflict = await findConflict({ startMinutes: toMinutes(startTime), endMinutes: toMinutes(endTime) }, id)
    if (conflict) {
      res.status(409).json({
        error: `Rate band overlaps with "${conflict.name}" (${formatTimeString(startTime)}-${formatTimeString(endTime)} conflicts with existing band)`,
      })
      return
    }
  }

  const band = await prisma.rateBand.update({ where: { id }, data })
  res.status(200).json({ rateBand: serializeRateBand(band) })
})

// Hard-delete if never referenced by historical attendance data; otherwise
// soft-delete (active=false) so old segments keep displaying the band that
// was actually applied at compute time (T4 acceptance criteria).
router.delete('/rate-bands/:id', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params
  const existing = await prisma.rateBand.findUnique({ where: { id } })
  if (!existing) {
    res.status(404).json({ error: 'Rate band not found' })
    return
  }

  const referencedCount = await prisma.attendanceSessionSegment.count({ where: { rateBandId: id } })
  if (referencedCount > 0) {
    const band = await prisma.rateBand.update({ where: { id }, data: { active: false } })
    res.status(200).json({ rateBand: serializeRateBand(band), softDeleted: true })
    return
  }

  await prisma.rateBand.delete({ where: { id } })
  res.status(204).send()
})

export default router
