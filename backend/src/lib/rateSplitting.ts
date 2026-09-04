// T9: Rate Splitting Engine — pure function, no DB access, per PRD's
// mandated algorithm order: (1) split at VN midnight boundaries, (2) within
// each day split at active rate-band boundaries, (3) apply holiday rate
// within each resulting segment, (4) any minute uncovered by an active band
// becomes a zero-rate "gap" segment with a warning instead of being dropped.
import { bandIntervals, vnCalendarDayLabel, vnDayStartInstant } from './timeOfDay'

export interface RateBandActive {
  id: string
  startMinutes: number
  endMinutes: number
  ratePerHourVnd: number
}

export interface HolidayActive {
  id: string
  // Date-only UTC instant, same representation as holidays.holiday_date /
  // vnCalendarDayLabel() (e.g. 2026-02-12T00:00:00Z labels "Feb 12, 2026 VN
  // time"), not a real instant boundary.
  dateUtc: Date
  rateType: 'PERCENT' | 'FIXED'
  rateValue: number
}

export interface RateSegment {
  segmentStart: Date
  segmentEnd: Date
  rateBandId: string | null
  holidayId: string | null
  hours: number
  rateAppliedVnd: number
  amountVnd: number
}

export interface RateSplitResult {
  segments: RateSegment[]
  totalHours: number
  totalAmountVnd: number
  warnings: string[]
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

// PERCENT/FIXED arithmetic (PRD T9 item 3 / T5 items 3-4) — the single
// implementation shared with lib/holidayRate.ts's applyHolidayRate, which
// delegates here so the DB-touching T5 module and this pure T9 module never
// duplicate the math (see AGENTS.md "Holiday rate calc is a standalone stub
// until T9").
export function applyHolidayRateToBase(baseRatePerHourVnd: number, holiday: { rateType: 'PERCENT' | 'FIXED'; rateValue: number }): number {
  if (holiday.rateType === 'FIXED') {
    return Math.round(holiday.rateValue)
  }
  return Math.round((baseRatePerHourVnd * holiday.rateValue) / 100)
}

interface MinuteSegment {
  start: number
  end: number
  bandId: string | null
  ratePerHourVnd: number
}

// Step 2: within one VN calendar day (as a [0,1440) minute window, itself
// already possibly a sub-range of the day if the session started/ended
// mid-day), split by active band boundaries. bandIntervals() already
// resolves a band that wraps past midnight into its same-day piece(s), so
// bands here are ordinary non-wrapping [start,end) ranges on the 0-1440
// line. Any minute not covered by a band becomes a gap segment
// (bandId=null) rather than being dropped — PRD T9 item 4.
function splitDayByBands(dayStartMin: number, dayEndMin: number, bands: RateBandActive[]): MinuteSegment[] {
  const owned = bands
    .flatMap((band) =>
      bandIntervals(band.startMinutes, band.endMinutes).map(([s, e]) => ({
        start: Math.max(s, dayStartMin),
        end: Math.min(e, dayEndMin),
        bandId: band.id,
        ratePerHourVnd: band.ratePerHourVnd,
      }))
    )
    .filter((o) => o.start < o.end)
    .sort((a, b) => a.start - b.start)

  const result: MinuteSegment[] = []
  let cursor = dayStartMin
  for (const o of owned) {
    if (o.start > cursor) {
      result.push({ start: cursor, end: o.start, bandId: null, ratePerHourVnd: 0 })
    }
    const start = Math.max(o.start, cursor)
    if (start < o.end) {
      result.push({ start, end: o.end, bandId: o.bandId, ratePerHourVnd: o.ratePerHourVnd })
      cursor = o.end
    }
  }
  if (cursor < dayEndMin) {
    result.push({ start: cursor, end: dayEndMin, bandId: null, ratePerHourVnd: 0 })
  }
  return result
}

// Step 3: apply the day's holiday (if any) to one band/gap sub-segment.
// Gap segments (no band) always stay rate_applied=0 — there is no band rate
// for a holiday percentage to multiply, per PRD T9 item 4 vs item 3.
function applyRate(segment: MinuteSegment, holiday: HolidayActive | undefined): { rateAppliedVnd: number; holidayId: string | null } {
  if (segment.bandId === null) {
    return { rateAppliedVnd: 0, holidayId: null }
  }
  if (!holiday) {
    return { rateAppliedVnd: segment.ratePerHourVnd, holidayId: null }
  }
  return { rateAppliedVnd: applyHolidayRateToBase(segment.ratePerHourVnd, holiday), holidayId: holiday.id }
}

export function splitSessionIntoSegments(
  loginTime: Date,
  logoutTime: Date,
  activeRateBands: RateBandActive[],
  activeHolidays: HolidayActive[]
): RateSplitResult {
  if (logoutTime <= loginTime) {
    throw new Error('logoutTime must be after loginTime')
  }

  const segments: RateSegment[] = []
  const warnings: string[] = []

  // Step 1: split [loginTime, logoutTime) at VN midnight boundaries.
  let cursor = loginTime
  while (cursor < logoutTime) {
    const dayLabel = vnCalendarDayLabel(cursor)
    const dayStartInstant = vnDayStartInstant(dayLabel)
    const nextDayStartInstant = new Date(dayStartInstant.getTime() + 24 * 60 * 60 * 1000)
    const chunkEnd = logoutTime < nextDayStartInstant ? logoutTime : nextDayStartInstant

    const dayStartMin = (cursor.getTime() - dayStartInstant.getTime()) / 60_000
    const dayEndMin = (chunkEnd.getTime() - dayStartInstant.getTime()) / 60_000

    const holiday = activeHolidays.find((h) => h.dateUtc.getTime() === dayLabel.getTime())

    for (const minuteSegment of splitDayByBands(dayStartMin, dayEndMin, activeRateBands)) {
      const { rateAppliedVnd, holidayId } = applyRate(minuteSegment, holiday)
      const hours = round2((minuteSegment.end - minuteSegment.start) / 60)
      const amountVnd = Math.round(hours * rateAppliedVnd)

      if (minuteSegment.bandId === null) {
        warnings.push(
          `${(minuteSegment.end - minuteSegment.start).toFixed(0)} phút (${new Date(
            dayStartInstant.getTime() + minuteSegment.start * 60_000
          ).toISOString()} - ${new Date(dayStartInstant.getTime() + minuteSegment.end * 60_000).toISOString()}) không rơi vào khung giờ nào đang active, tạm tính đơn giá 0đ. Vui lòng bổ sung khung giờ.`
        )
      }

      segments.push({
        segmentStart: new Date(dayStartInstant.getTime() + minuteSegment.start * 60_000),
        segmentEnd: new Date(dayStartInstant.getTime() + minuteSegment.end * 60_000),
        rateBandId: minuteSegment.bandId,
        holidayId,
        hours,
        rateAppliedVnd,
        amountVnd,
      })
    }

    cursor = chunkEnd
  }

  const totalHours = round2(segments.reduce((sum, s) => sum + s.hours, 0))
  const totalAmountVnd = segments.reduce((sum, s) => sum + s.amountVnd, 0)

  return { segments, totalHours, totalAmountVnd, warnings }
}
