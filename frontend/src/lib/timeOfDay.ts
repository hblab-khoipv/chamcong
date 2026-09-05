// Mirrors the wrap-past-midnight convention documented in backend
// AGENTS.md / backend/src/lib/timeOfDay.ts: when end <= start, the band
// wraps past midnight. For a single generic 24h day (0-1440 minutes) this
// splits into up to two half-open intervals: [start, 1440) and [0, end).
// Used here purely for the visual timeline, not for any pay calculation.
export function parseTimeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function bandIntervals(startTime: string, endTime: string): Array<[number, number]> {
  const start = parseTimeToMinutes(startTime)
  const end = parseTimeToMinutes(endTime)

  if (end > start) return [[start, end]]

  const intervals: Array<[number, number]> = [[start, 1440]]
  if (end > 0) intervals.push([0, end])
  return intervals
}
