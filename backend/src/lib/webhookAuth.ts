import { Request } from 'express'

// T6 item 2 / PRD assumption #3: authentication is deliberately NOT
// implemented at this stage. This no-op is the explicit placeholder T17
// will fill in (HMAC/token signature check against WEBHOOK_SECRET) without
// having to touch the main webhook flow. Always accepts for now — every
// schema-valid request is processed regardless of headers.
export function verifyWebhookAuth(_req: Request): true {
  return true
}
