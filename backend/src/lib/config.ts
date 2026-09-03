// Env-based settings for Phase 3. There is no Settings entity/Admin UI yet
// (that's T14, Phase 5) so these read straight from env vars, matching the
// PRD's stated defaults (assumption #3 item 8, T7 item 2).
const DEFAULT_STALE_HOURS = 16

export function isAutoCreateEmployeeOnWebhookEnabled(): boolean {
  return process.env.AUTO_CREATE_EMPLOYEE_ON_WEBHOOK !== 'false'
}

export function getSessionStaleThresholdHours(): number {
  const raw = process.env.ATTENDANCE_SESSION_STALE_HOURS
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STALE_HOURS
}
