import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../lib/db'
import { resetDb } from './testUtils/db'

describe('T1 data model constraints', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await resetDb()
  })

  it('rejects a duplicate dedupe_key on attendance_events', async () => {
    const employee = await prisma.employee.create({ data: { name: 'Emp', source: 'manual' } })

    await prisma.attendanceEvent.create({
      data: {
        employeeExternalId: 'EMP1',
        employeeId: employee.id,
        eventType: 'LOGIN',
        eventTime: new Date('2026-01-05T09:00:00+07:00'),
        rawPayload: {},
        dedupeKey: 'dupe-key-1',
      },
    })

    await expect(
      prisma.attendanceEvent.create({
        data: {
          employeeExternalId: 'EMP1',
          employeeId: employee.id,
          eventType: 'LOGOUT',
          eventTime: new Date('2026-01-05T17:00:00+07:00'),
          rawPayload: {},
          dedupeKey: 'dupe-key-1',
        },
      })
    ).rejects.toThrow()
  })

  it('rejects a duplicate holiday_date on holidays', async () => {
    const holidayDate = new Date('2026-09-02T00:00:00.000Z')

    await prisma.holiday.create({
      data: { holidayDate, name: 'Quốc khánh', rateType: 'PERCENT', rateValue: 200 },
    })

    await expect(
      prisma.holiday.create({
        data: { holidayDate, name: 'Trùng ngày', rateType: 'FIXED', rateValue: 50000 },
      })
    ).rejects.toThrow()
  })
})
