// In-memory login rate limiter, keyed by email. Single-process store is
// sufficient for this app's scale (single small-business deployment, T2
// scope); a distributed store would only be needed behind multiple app
// instances, which is out of scope here.
interface AttemptRecord {
  count: number
  lockedUntil: number | null
}

const attempts = new Map<string, AttemptRecord>()

export const MAX_ATTEMPTS = 5
export const LOCK_DURATION_MS = 5 * 60 * 1000

function keyFor(email: string): string {
  return email.trim().toLowerCase()
}

export function isLocked(email: string): boolean {
  const key = keyFor(email)
  const record = attempts.get(key)
  if (!record || !record.lockedUntil) {
    return false
  }
  if (Date.now() >= record.lockedUntil) {
    attempts.delete(key)
    return false
  }
  return true
}

export function recordFailure(email: string): void {
  const key = keyFor(email)
  const record = attempts.get(key) ?? { count: 0, lockedUntil: null }
  record.count += 1
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCK_DURATION_MS
  }
  attempts.set(key, record)
}

export function resetAttempts(email: string): void {
  attempts.delete(keyFor(email))
}

// Test-only: clears all tracked attempts so test cases don't leak state
// (and don't have to wait out real lock windows) into one another.
export function resetAllAttemptsForTests(): void {
  attempts.clear()
}
