// Time-of-day helpers for rate_bands (T4). Convention: when end_time <=
// start_time, the band wraps past midnight and ends on the next calendar
// day (see AGENTS.md "Rate band time-of-day convention"). All math here
// works on minutes-since-midnight (0-1439) plus a half-open [start, end)
// interval representation on a fixed 0-1440 line, splitting a wrapping
// band into its two same-day pieces.

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/

export function parseTimeString(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const match = TIME_REGEX.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0))
}

export function formatTimeString(date: Date): string {
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

// Formats a raw minute count (0-1440) as HH:MM, allowing "24:00" — unlike
// formatTimeString/the DB TIME column, gap/coverage output isn't tied to a
// storable time-of-day value, so the literal midnight-end case can be shown.
export function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function toMinutes(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes()
}

// Vietnam has a single fixed UTC+7 offset, no DST (PRD assumption #4).
// login_time/logout_time are stored as real UTC instants, so the rate
// engine (T9) needs to know which VN wall-clock minute-of-day and which VN
// calendar day an instant falls on — these three helpers are that bridge.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000

// Returns a Date whose UTC getters read as VN wall-clock time for `date`.
// Not a real instant — a shifted view used only to read Y/M/D/H/M via
// getUTC*() without a timezone library.
function shiftToVnWallClock(date: Date): Date {
  return new Date(date.getTime() + VN_OFFSET_MS)
}

// Minutes since VN midnight (0-1439) that `date` falls in.
export function vnMinutesOfDay(date: Date): number {
  const shifted = shiftToVnWallClock(date)
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
}

// The VN calendar day `date` falls on, as a date-only UTC instant (e.g.
// 2026-08-30T00:00:00Z labels "August 30, 2026 VN time") — the same
// representation `holidays.holiday_date` is stored in, so the two compare
// directly with getTime().
export function vnCalendarDayLabel(date: Date): Date {
  const shifted = shiftToVnWallClock(date)
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()))
}

// The real UTC instant of VN midnight (00:00 VN time) for the calendar day
// identified by `dayLabel` (as returned by vnCalendarDayLabel).
export function vnDayStartInstant(dayLabel: Date): Date {
  return new Date(dayLabel.getTime() - VN_OFFSET_MS)
}

export type MinuteInterval = [number, number]

export function bandIntervals(startMinutes: number, endMinutes: number): MinuteInterval[] {
  if (endMinutes > startMinutes) {
    return [[startMinutes, endMinutes]]
  }
  const intervals: MinuteInterval[] = [[startMinutes, 1440]]
  if (endMinutes > 0) {
    intervals.push([0, endMinutes])
  }
  return intervals
}

function intervalsOverlap(a: MinuteInterval, b: MinuteInterval): boolean {
  return a[0] < b[1] && b[0] < a[1]
}

export function bandDurationHours(startMinutes: number, endMinutes: number): number {
  const totalMinutes = bandIntervals(startMinutes, endMinutes).reduce((sum, [a, b]) => sum + (b - a), 0)
  return totalMinutes / 60
}

export interface NamedBandRange {
  id: string
  name: string
  startMinutes: number
  endMinutes: number
}

// Returns the first existing band whose interval(s) overlap the candidate's,
// or null if there's no conflict.
export function findOverlappingBand(
  candidate: { startMinutes: number; endMinutes: number },
  existingBands: NamedBandRange[]
): NamedBandRange | null {
  const candidateIntervals = bandIntervals(candidate.startMinutes, candidate.endMinutes)
  for (const band of existingBands) {
    const bandInts = bandIntervals(band.startMinutes, band.endMinutes)
    for (const ci of candidateIntervals) {
      for (const bi of bandInts) {
        if (intervalsOverlap(ci, bi)) {
          return band
        }
      }
    }
  }
  return null
}

// Merges all active bands' intervals and returns the uncovered gaps on the
// 0-1440 line, sorted left to right.
export function computeGaps(bands: { startMinutes: number; endMinutes: number }[]): MinuteInterval[] {
  const intervals = bands.flatMap((b) => bandIntervals(b.startMinutes, b.endMinutes))
  intervals.sort((a, b) => a[0] - b[0])

  const merged: MinuteInterval[] = []
  for (const [start, end] of intervals) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end)
    } else {
      merged.push([start, end])
    }
  }

  const gaps: MinuteInterval[] = []
  let cursor = 0
  for (const [start, end] of merged) {
    if (start > cursor) gaps.push([cursor, start])
    cursor = Math.max(cursor, end)
  }
  if (cursor < 1440) gaps.push([cursor, 1440])

  return gaps
}
