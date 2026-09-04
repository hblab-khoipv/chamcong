// T10: bridges the pure T9 engine (rateSplitting.ts) into the session
// lifecycle. `recomputeSessionSegments` is the single entry point reused by
// T10 (session close) and T11 (manual correction, explicit recompute) — see
// AGENTS.md's note on processAttendanceEvent for the same "one code path"
// rationale. It's composed of `fetchActiveRateConfig` and
// `persistSegmentsOrFlagError`, exported individually so tests can exercise
// the "config read here, DB mutated before the write lands" race (T10 item
// 3) deterministically instead of relying on real concurrency timing.
import { AttendanceSession, Holiday, RateBand } from '@prisma/client'
import { prisma } from './db'
import { HolidayActive, RateBandActive, RateSplitResult, splitSessionIntoSegments } from './rateSplitting'
import { toMinutes } from './timeOfDay'

function toRateBandActive(band: RateBand): RateBandActive {
  return {
    id: band.id,
    startMinutes: toMinutes(band.startTime),
    endMinutes: toMinutes(band.endTime),
    ratePerHourVnd: band.ratePerHourVnd,
  }
}

function toHolidayActive(holiday: Holiday): HolidayActive {
  return {
    id: holiday.id,
    dateUtc: holiday.holidayDate,
    rateType: holiday.rateType,
    rateValue: Number(holiday.rateValue),
  }
}

export async function fetchActiveRateConfig(): Promise<{ bands: RateBandActive[]; holidays: HolidayActive[] }> {
  const [bands, holidays] = await Promise.all([
    prisma.rateBand.findMany({ where: { active: true } }),
    prisma.holiday.findMany({ where: { active: true } }),
  ])
  return { bands: bands.map(toRateBandActive), holidays: holidays.map(toHolidayActive) }
}

// T10 item 2: overwrites any previous segments and snapshots
// rate_applied_vnd/amount_vnd on each row — later rate-band/holiday edits
// never touch rows already written here.
async function persistSegments(sessionId: string, result: RateSplitResult): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.attendanceSessionSegment.deleteMany({ where: { sessionId } })
    for (const segment of result.segments) {
      await tx.attendanceSessionSegment.create({
        data: {
          sessionId,
          rateBandId: segment.rateBandId,
          holidayId: segment.holidayId,
          segmentStart: segment.segmentStart,
          segmentEnd: segment.segmentEnd,
          hours: segment.hours,
          rateAppliedVnd: segment.rateAppliedVnd,
          amountVnd: segment.amountVnd,
        },
      })
    }
    await tx.attendanceSession.update({
      where: { id: sessionId },
      data: {
        totalHours: result.totalHours,
        totalAmountVnd: result.totalAmountVnd,
        computedAt: new Date(),
        computationError: false,
        computationErrorMessage: null,
      },
    })
  })
}

// T10 item 3: if writing the computed segments fails (e.g. a rate band
// referenced by `result` was deleted from under it after the config was
// read), flag computation_error instead of throwing — the session keeps
// whatever status it already had.
export async function persistSegmentsOrFlagError(sessionId: string, result: RateSplitResult): Promise<void> {
  try {
    await persistSegments(sessionId, result)
  } catch (err) {
    await prisma.attendanceSession.update({
      where: { id: sessionId },
      data: { computationError: true, computationErrorMessage: err instanceof Error ? err.message : String(err) },
    })
  }
}

// T10 item 1 & 3: (re)computes segments for a session against the
// *currently* active rate bands/holidays and persists them, or — on any
// failure — flags computation_error instead of throwing, so a bad session
// never crashes the caller (webhook intake, manual correction, explicit
// recompute). A session missing login_time or logout_time (still OPEN, or
// FLAGGED with one side missing) has nothing to compute yet and is
// returned unchanged.
export async function recomputeSessionSegments(sessionId: string): Promise<AttendanceSession> {
  const session = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: sessionId } })
  if (!session.loginTime || !session.logoutTime) {
    return session
  }

  try {
    const config = await fetchActiveRateConfig()
    const result = splitSessionIntoSegments(session.loginTime, session.logoutTime, config.bands, config.holidays)
    await persistSegmentsOrFlagError(sessionId, result)
  } catch (err) {
    await prisma.attendanceSession.update({
      where: { id: sessionId },
      data: { computationError: true, computationErrorMessage: err instanceof Error ? err.message : String(err) },
    })
  }

  return prisma.attendanceSession.findUniqueOrThrow({ where: { id: sessionId } })
}
