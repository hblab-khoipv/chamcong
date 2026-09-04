import { describe, expect, it } from 'vitest'
import { HolidayActive, RateBandActive, splitSessionIntoSegments } from '../lib/rateSplitting'

// PRD T9 fixed example: 3 bands covering 24h with no gap, all at
// 23,000 VND/h — 06:00-17:00, 17:00-24:00, 00:00-06:00.
const BAND_1: RateBandActive = { id: 'band-1', startMinutes: 6 * 60, endMinutes: 17 * 60, ratePerHourVnd: 23000 }
const BAND_2: RateBandActive = { id: 'band-2', startMinutes: 17 * 60, endMinutes: 0, ratePerHourVnd: 23000 }
const BAND_3: RateBandActive = { id: 'band-3', startMinutes: 0, endMinutes: 6 * 60, ratePerHourVnd: 23000 }
const THREE_BANDS = [BAND_1, BAND_2, BAND_3]

// VN local time helper: '2026-01-05T09:00' -> the UTC instant for 09:00 VN
// time on 2026-01-05 (VN = UTC+7).
function vn(localIso: string): Date {
  return new Date(`${localIso}:00+07:00`)
}

describe('T9 rate splitting engine', () => {
  it('09:00-17:00 same-band weekday -> 1 segment, 8h x 23,000 = 184,000', () => {
    const result = splitSessionIntoSegments(vn('2026-01-05T09:00'), vn('2026-01-05T17:00'), THREE_BANDS, [])

    expect(result.segments).toHaveLength(1)
    expect(result.segments[0].rateBandId).toBe('band-1')
    expect(result.segments[0].hours).toBe(8)
    expect(result.segments[0].rateAppliedVnd).toBe(23000)
    expect(result.segments[0].amountVnd).toBe(184000)
    expect(result.totalHours).toBe(8)
    expect(result.totalAmountVnd).toBe(184000)
  })

  it('07:00-10:00 weekday -> 1 segment (not split at 09:00, 6h-9h merges into the 06-17 band)', () => {
    const result = splitSessionIntoSegments(vn('2026-01-05T07:00'), vn('2026-01-05T10:00'), THREE_BANDS, [])

    expect(result.segments).toHaveLength(1)
    expect(result.segments[0].rateBandId).toBe('band-1')
    expect(result.segments[0].hours).toBe(3)
    expect(result.segments[0].amountVnd).toBe(69000)
  })

  it('15:00-19:00 weekday -> 2 segments: 15-17 (band 1) + 17-19 (band 2), 4h total', () => {
    const result = splitSessionIntoSegments(vn('2026-01-05T15:00'), vn('2026-01-05T19:00'), THREE_BANDS, [])

    expect(result.segments).toHaveLength(2)
    expect(result.segments[0]).toMatchObject({ rateBandId: 'band-1', hours: 2, amountVnd: 46000 })
    expect(result.segments[1]).toMatchObject({ rateBandId: 'band-2', hours: 2, amountVnd: 46000 })
    expect(result.totalHours).toBe(4)
    expect(result.totalAmountVnd).toBe(92000)
  })

  it('22:00-02:00 crossing midnight, no holiday -> 22-24 (band 2, day A) + 00-02 (band 3, day B)', () => {
    const result = splitSessionIntoSegments(vn('2026-01-05T22:00'), vn('2026-01-06T02:00'), THREE_BANDS, [])

    expect(result.segments).toHaveLength(2)
    expect(result.segments[0]).toMatchObject({ rateBandId: 'band-2', hours: 2, amountVnd: 46000, holidayId: null })
    expect(result.segments[0].segmentStart.toISOString()).toBe(vn('2026-01-05T22:00').toISOString())
    expect(result.segments[0].segmentEnd.toISOString()).toBe(vn('2026-01-06T00:00').toISOString())
    expect(result.segments[1]).toMatchObject({ rateBandId: 'band-3', hours: 2, amountVnd: 46000, holidayId: null })
    expect(result.segments[1].segmentEnd.toISOString()).toBe(vn('2026-01-06T02:00').toISOString())
    expect(result.totalHours).toBe(4)
    expect(result.totalAmountVnd).toBe(92000)
  })

  it('23:00 (holiday PERCENT 200%) -> 01:00 next day (not holiday) -> only the holiday-day segment is doubled', () => {
    const holiday: HolidayActive = { id: 'hol-1', dateUtc: new Date('2026-01-05T00:00:00Z'), rateType: 'PERCENT', rateValue: 200 }
    const result = splitSessionIntoSegments(vn('2026-01-05T23:00'), vn('2026-01-06T01:00'), THREE_BANDS, [holiday])

    expect(result.segments).toHaveLength(2)
    expect(result.segments[0]).toMatchObject({ rateBandId: 'band-2', hours: 1, rateAppliedVnd: 46000, amountVnd: 46000, holidayId: 'hol-1' })
    expect(result.segments[1]).toMatchObject({ rateBandId: 'band-3', hours: 1, rateAppliedVnd: 23000, amountVnd: 23000, holidayId: null })
    expect(result.totalHours).toBe(2)
    expect(result.totalAmountVnd).toBe(69000)
  })

  it('login/logout entirely within a FIXED=50,000/h holiday, crossing 2 bands -> both segments use 50,000 regardless of band', () => {
    const holiday: HolidayActive = { id: 'hol-2', dateUtc: new Date('2026-01-05T00:00:00Z'), rateType: 'FIXED', rateValue: 50000 }
    const result = splitSessionIntoSegments(vn('2026-01-05T05:00'), vn('2026-01-05T08:00'), THREE_BANDS, [holiday])

    expect(result.segments).toHaveLength(2)
    expect(result.segments[0]).toMatchObject({ rateBandId: 'band-3', hours: 1, rateAppliedVnd: 50000, amountVnd: 50000, holidayId: 'hol-2' })
    expect(result.segments[1]).toMatchObject({ rateBandId: 'band-1', hours: 2, rateAppliedVnd: 50000, amountVnd: 100000, holidayId: 'hol-2' })
    expect(result.totalHours).toBe(3)
    expect(result.totalAmountVnd).toBe(150000)
  })

  it('a 1-minute session rounds to 0.02h, not 0 or 1 hour', () => {
    const result = splitSessionIntoSegments(vn('2026-01-05T09:00'), new Date(vn('2026-01-05T09:00').getTime() + 60_000), THREE_BANDS, [])

    expect(result.segments).toHaveLength(1)
    expect(result.segments[0].hours).toBe(0.02)
    expect(result.segments[0].hours).not.toBe(0)
    expect(result.segments[0].hours).not.toBe(1)
    expect(result.segments[0].amountVnd).toBe(Math.round(0.02 * 23000))
  })

  it('a gap in coverage (band 1 shrunk to 09:00-17:00) still produces a segment: rate_applied=0, hours not dropped from the total', () => {
    const shrunkBand1: RateBandActive = { ...BAND_1, startMinutes: 9 * 60 }
    const bands = [shrunkBand1, BAND_2, BAND_3]

    const result = splitSessionIntoSegments(vn('2026-01-05T07:00'), vn('2026-01-05T10:00'), bands, [])

    expect(result.segments).toHaveLength(2)
    expect(result.segments[0]).toMatchObject({ rateBandId: null, hours: 2, rateAppliedVnd: 0, amountVnd: 0 })
    expect(result.segments[1]).toMatchObject({ rateBandId: 'band-1', hours: 1, rateAppliedVnd: 23000, amountVnd: 23000 })
    expect(result.totalHours).toBe(3)
    expect(result.warnings).toHaveLength(1)
  })

  it('is deterministic: the same input run twice produces identical output', () => {
    const holiday: HolidayActive = { id: 'hol-1', dateUtc: new Date('2026-01-05T00:00:00Z'), rateType: 'PERCENT', rateValue: 200 }
    const run1 = splitSessionIntoSegments(vn('2026-01-05T23:00'), vn('2026-01-06T02:00'), THREE_BANDS, [holiday])
    const run2 = splitSessionIntoSegments(vn('2026-01-05T23:00'), vn('2026-01-06T02:00'), THREE_BANDS, [holiday])

    expect(run2).toEqual(run1)
  })
})
