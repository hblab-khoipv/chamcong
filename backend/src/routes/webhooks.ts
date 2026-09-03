import { AttendanceEventType, Prisma } from '@prisma/client'
import { Request, Response, Router } from 'express'
import { prisma } from '../lib/db'
import { verifyWebhookAuth } from '../lib/webhookAuth'
import { computeDedupeKey } from '../lib/dedupeKey'
import { processAttendanceEvent } from '../lib/attendanceProcessing'

const router = Router()

const VALID_EVENT_TYPES = new Set(['LOGIN', 'LOGOUT'])

function pickHeaders(req: Request): Record<string, unknown> {
  return {
    'content-type': req.headers['content-type'] ?? null,
    'user-agent': req.headers['user-agent'] ?? null,
    authorization: req.headers.authorization ? 'present' : null,
  }
}

async function logWebhook(req: Request, resultStatus: string, reason?: string): Promise<void> {
  await prisma.webhookLog.create({
    data: {
      rawBody: (req.body ?? null) as Prisma.InputJsonValue,
      headers: pickHeaders(req) as Prisma.InputJsonValue,
      resultStatus,
      reason: reason ?? null,
    },
  })
}

// T6: POST /webhooks/attendance — receives LOGIN/LOGOUT events from the POS
// app. No auth middleware here on purpose — see verifyWebhookAuth (T17
// placeholder) and AGENTS.md "Auth model".
router.post('/webhooks/attendance', async (req: Request, res: Response) => {
  verifyWebhookAuth(req)

  const body = (req.body ?? {}) as Record<string, unknown>
  const employeeExternalId = body.employee_external_id
  const eventType = body.event_type
  const eventTimeRaw = body.event_time
  const eventId = body.event_id

  if (typeof employeeExternalId !== 'string' || !employeeExternalId.trim()) {
    await logWebhook(req, 'error', 'missing or invalid employee_external_id')
    res.status(400).json({ error: 'employee_external_id is required' })
    return
  }

  if (typeof eventType !== 'string' || !VALID_EVENT_TYPES.has(eventType)) {
    await logWebhook(req, 'error', 'missing or invalid event_type')
    res.status(400).json({ error: 'event_type must be LOGIN or LOGOUT' })
    return
  }

  if (typeof eventTimeRaw !== 'string' || Number.isNaN(new Date(eventTimeRaw).getTime())) {
    await logWebhook(req, 'error', 'missing or invalid event_time')
    res.status(400).json({ error: 'event_time is required and must be a valid ISO timestamp' })
    return
  }

  const trimmedExternalId = employeeExternalId.trim()
  const eventTime = new Date(eventTimeRaw)
  const dedupeKey = computeDedupeKey(eventId, trimmedExternalId, eventType, eventTimeRaw)

  const existing = await prisma.attendanceEvent.findUnique({ where: { dedupeKey } })
  if (existing) {
    await logWebhook(req, 'duplicate')
    res.status(200).json({ status: 'duplicate', attendanceEventId: existing.id })
    return
  }

  let event
  try {
    event = await prisma.attendanceEvent.create({
      data: {
        employeeExternalId: trimmedExternalId,
        eventType: eventType as AttendanceEventType,
        eventTime,
        rawPayload: body as Prisma.InputJsonValue,
        dedupeKey,
        processStatus: 'PENDING',
      },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Concurrent duplicate — another request with the same dedupe_key won.
      const duplicate = await prisma.attendanceEvent.findUniqueOrThrow({ where: { dedupeKey } })
      await logWebhook(req, 'duplicate')
      res.status(200).json({ status: 'duplicate', attendanceEventId: duplicate.id })
      return
    }
    throw err
  }

  await logWebhook(req, 'accepted')

  // T6 item 5: processed synchronously (T7/T8) before responding — fast
  // enough not to need a queue at this scale. Processing errors/warnings
  // never turn into a webhook error response (T6 item 6: warnings must not
  // make the POS app retry-storm).
  await processAttendanceEvent(event.id)

  res.status(200).json({ status: 'accepted', attendanceEventId: event.id })
})

export default router
