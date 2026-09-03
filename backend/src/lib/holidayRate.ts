import { Holiday } from '@prisma/client'
import { prisma } from './db'

// Internal equivalent of "GET /holidays/:date" (T5 item 6) — used by the
// rate engine (T9, not yet built) to check whether a calendar date is a
// holiday. Deliberately not exposed as an HTTP endpoint, per the PRD ("có
// thể là hàm service, không nhất thiết expose API").
export async function getActiveHolidayForDate(date: Date): Promise<Holiday | null> {
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  return prisma.holiday.findFirst({ where: { holidayDate: dayStart, active: true } })
}

// Pure arithmetic for T5's PERCENT/FIXED semantics (yêu cầu chức năng #3-4):
// PERCENT scales the rate band's own hourly rate; FIXED overrides it
// entirely. Wiring this into actual attendance session segments is T9's
// rate splitting engine (out of scope here) — this is the calculation it
// will call.
export function applyHolidayRate(baseRatePerHourVnd: number, holiday: Pick<Holiday, 'rateType' | 'rateValue'>): number {
  if (holiday.rateType === 'FIXED') {
    return Number(holiday.rateValue)
  }
  return Math.round((baseRatePerHourVnd * Number(holiday.rateValue)) / 100)
}
