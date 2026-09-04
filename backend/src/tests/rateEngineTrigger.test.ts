import { describe, expect, it, beforeEach, afterAll } from 'vitest'
import { prisma } from '../lib/db'
import { handleLoginEvent, handleLogoutEvent } from '../lib/attendanceSession'
import { fetchActiveRateConfig, persistSegmentsOrFlagError } from '../lib/sessionRateEngine'
import { splitSessionIntoSegments } from '../lib/rateSplitting'
import { resetDb } from './testUtils/db'

async function createBand(overrides: Partial<{ name: string; startTime: string; endTime: string; ratePerHourVnd: number }> = {}) {
  const timeOfDay = (hhmm: string) => new Date(Date.UTC(1970, 0, 1, Number(hhmm.split(':')[0]), Number(hhmm.split(':')[1])))
  return prisma.rateBand.create({
    data: {
      name: overrides.name ?? 'Ca 1',
      startTime: timeOfDay(overrides.startTime ?? '06:00'),
      endTime: timeOfDay(overrides.endTime ?? '17:00'),
      ratePerHourVnd: overrides.ratePerHourVnd ?? 23000,
    },
  })
}

async function createDefaultThreeBands(ratePerHourVnd = 23000) {
  await createBand({ name: 'Ca 1', startTime: '06:00', endTime: '17:00', ratePerHourVnd })
  await createBand({ name: 'Ca 2', startTime: '17:00', endTime: '00:00', ratePerHourVnd })
  await createBand({ name: 'Ca 3', startTime: '00:00', endTime: '06:00', ratePerHourVnd })
}

describe('T10 trigger calculation on session close & config change', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await resetDb()
  })

  // T10 test case: "Đóng session → segment + tổng tiền xuất hiện ngay trong response/DB."
  it('closing a session via LOGOUT computes segments and totals immediately', async () => {
    await createDefaultThreeBands()
    const employee = await prisma.employee.create({ data: { name: 'Emp', source: 'manual' } })

    await handleLoginEvent(employee.id, new Date('2026-01-05T09:00:00+07:00'))
    const closed = await handleLogoutEvent(employee.id, new Date('2026-01-05T17:00:00+07:00'))

    expect(closed.status).toBe('CLOSED')
    expect(Number(closed.totalHours)).toBe(8)
    expect(closed.totalAmountVnd).toBe(184000)
    expect(closed.computedAt).not.toBeNull()
    expect(closed.computationError).toBe(false)

    const segments = await prisma.attendanceSessionSegment.findMany({ where: { sessionId: closed.id } })
    expect(segments).toHaveLength(1)
    expect(segments[0].amountVnd).toBe(184000)
  })

  // T10 test case: "Sửa đơn giá rate band từ 23.000 → 30.000, sau đó query
  // lại session đã tính trước đó → vẫn ra số cũ (23.000)."
  it('editing a rate band after a session is computed does not change that session on re-query', async () => {
    await createDefaultThreeBands()
    const employee = await prisma.employee.create({ data: { name: 'Emp', source: 'manual' } })

    await handleLoginEvent(employee.id, new Date('2026-01-05T09:00:00+07:00'))
    const closed = await handleLogoutEvent(employee.id, new Date('2026-01-05T17:00:00+07:00'))
    expect(closed.totalAmountVnd).toBe(184000)

    const band1 = await prisma.rateBand.findFirstOrThrow({ where: { name: 'Ca 1' } })
    await prisma.rateBand.update({ where: { id: band1.id }, data: { ratePerHourVnd: 30000 } })

    const requeried = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: closed.id } })
    expect(requeried.totalAmountVnd).toBe(184000)

    const segment = await prisma.attendanceSessionSegment.findFirstOrThrow({ where: { sessionId: closed.id } })
    expect(segment.rateAppliedVnd).toBe(23000)
  })

  // T10 test case: "Giả lập lỗi (xoá rate band đang được tham chiếu ngay
  // trong lúc tính) → session không tính được nhưng hệ thống không crash,
  // có cờ lỗi rõ ràng." Simulated deterministically without relying on real
  // concurrency timing: read the active config and compute segments from it
  // (exactly what recomputeSessionSegments does internally), then delete
  // the referenced band "in the middle of computing" — after the snapshot
  // was taken but before it's persisted — and confirm the persist step
  // catches the resulting FK violation instead of throwing.
  it('a rate band deleted mid-computation sets computation_error instead of crashing', async () => {
    await createDefaultThreeBands()
    const employee = await prisma.employee.create({ data: { name: 'Emp', source: 'manual' } })
    await handleLoginEvent(employee.id, new Date('2026-01-05T09:00:00+07:00'))
    const closed = await handleLogoutEvent(employee.id, new Date('2026-01-05T17:00:00+07:00'))
    expect(closed.computationError).toBe(false)
    expect(closed.loginTime).not.toBeNull()
    expect(closed.logoutTime).not.toBeNull()

    const config = await fetchActiveRateConfig()
    const result = splitSessionIntoSegments(closed.loginTime as Date, closed.logoutTime as Date, config.bands, config.holidays)

    const band1 = await prisma.rateBand.findFirstOrThrow({ where: { name: 'Ca 1' } })
    // Clear the old segment referencing band1 (the FK would otherwise block
    // the delete) and remove the band itself -- simulating it being deleted
    // in the window between "config read" and "segments written".
    await prisma.attendanceSessionSegment.deleteMany({ where: { rateBandId: band1.id } })
    await prisma.rateBand.delete({ where: { id: band1.id } })

    await persistSegmentsOrFlagError(closed.id, result)

    const afterFailedPersist = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: closed.id } })
    expect(afterFailedPersist.status).toBe('CLOSED')
    expect(afterFailedPersist.computationError).toBe(true)
    expect(afterFailedPersist.computationErrorMessage).toBeTruthy()
  })
})
