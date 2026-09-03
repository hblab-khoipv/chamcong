import { createHash } from 'crypto'

// T6 item 3: dedupe_key = event_id if provided, else a hash of the
// (external_id, event_type, event_time) triple, so a retried webhook
// without an event_id still collapses to the same key.
export function computeDedupeKey(
  eventId: unknown,
  employeeExternalId: string,
  eventType: string,
  eventTimeRaw: string
): string {
  if (typeof eventId === 'string' && eventId.trim()) {
    return eventId.trim()
  }
  if (typeof eventId === 'number' && Number.isFinite(eventId)) {
    return String(eventId)
  }
  return createHash('sha256').update(`${employeeExternalId}:${eventType}:${eventTimeRaw}`).digest('hex')
}
