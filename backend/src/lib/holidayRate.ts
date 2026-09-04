import { Holiday } from '@prisma/client'
import { prisma } from './db'
import { applyHolidayRateToBase } from './rateSplitting'

// Internal equivalent of "GET /holidays/:date" (T5 item 6) — used by the
// rate engine (T9, not yet built) to check whether a calendar date is a
// holiday. Deliberately not exposed as an HTTP endpoint, per the PRD ("có
// thể là hàm service, không nhất thiết expose API").
export async function getActiveHolidayForDate(date: Date): Promise<Holiday | null> {
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  return prisma.holiday.findFirst({ where: { holidayDate: dayStart, active: true } })
}

// T5's PERCENT/FIXED semantics (yêu cầu chức năng #3-4): PERCENT scales the
// rate band's own hourly rate; FIXED overrides it entirely. Delegates to the
// T9 rate splitting engine's copy of this arithmetic (rateSplitting.ts) so
// the two never drift apart.
export function applyHolidayRate(baseRatePerHourVnd: number, holiday: Pick<Holiday, 'rateType' | 'rateValue'>): number {
  return applyHolidayRateToBase(baseRatePerHourVnd, { rateType: holiday.rateType, rateValue: Number(holiday.rateValue) })
}
