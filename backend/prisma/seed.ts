// Idempotent seed script (T1). Safe to run more than once: existing records
// are detected and skipped instead of raising unique-constraint errors.
import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const BCRYPT_ROUNDS = 10

function timeOfDay(hhmm: string): Date {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0))
}

async function seedAdmin(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@chamcong.local'
  const existing = await prisma.admin.findUnique({ where: { email } })
  if (existing) {
    console.log(`[seed] Admin "${email}" already exists, skipping.`)
    return
  }

  const password = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(9).toString('base64url')
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

  await prisma.admin.create({
    data: {
      email,
      passwordHash,
      name: process.env.SEED_ADMIN_NAME ?? 'Admin',
    },
  })

  console.log(`[seed] Created default admin: ${email}`)
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log(`[seed] Generated password (save this, it will not be shown again): ${password}`)
  }
}

// Convention (documented for T4/T9, which own the business logic that reads
// these rows): start_time/end_time are time-of-day only. When end_time <=
// start_time, the band wraps past midnight, ending at end_time on the next
// calendar day — e.g. 17:00-00:00 covers 17:00 today through 24:00 (today),
// and 22:00-06:00 covers 22:00 today through 06:00 tomorrow.
async function seedRateBands(): Promise<void> {
  const bands = [
    { name: 'Ca 1', startTime: '06:00', endTime: '17:00', ratePerHourVnd: 23000 },
    { name: 'Ca 2', startTime: '17:00', endTime: '00:00', ratePerHourVnd: 23000 },
    { name: 'Ca 3', startTime: '00:00', endTime: '06:00', ratePerHourVnd: 23000 },
  ]

  for (const band of bands) {
    const existing = await prisma.rateBand.findFirst({ where: { name: band.name } })
    if (existing) {
      console.log(`[seed] Rate band "${band.name}" already exists, skipping.`)
      continue
    }

    await prisma.rateBand.create({
      data: {
        name: band.name,
        startTime: timeOfDay(band.startTime),
        endTime: timeOfDay(band.endTime),
        ratePerHourVnd: band.ratePerHourVnd,
      },
    })
    console.log(`[seed] Created rate band "${band.name}" (${band.startTime}-${band.endTime}, ${band.ratePerHourVnd}đ/h)`)
  }
}

async function seedHolidays(): Promise<void> {
  const year = new Date().getFullYear()
  const holidays = [
    { date: `${year}-01-01`, name: 'Tết Dương lịch' },
    { date: `${year}-04-30`, name: 'Giải phóng miền Nam' },
    { date: `${year}-05-01`, name: 'Quốc tế Lao động' },
    { date: `${year}-09-02`, name: 'Quốc khánh' },
  ]

  for (const holiday of holidays) {
    const holidayDate = new Date(`${holiday.date}T00:00:00.000Z`)
    const existing = await prisma.holiday.findUnique({ where: { holidayDate } })
    if (existing) {
      console.log(`[seed] Holiday "${holiday.date}" already exists, skipping.`)
      continue
    }

    await prisma.holiday.create({
      data: {
        holidayDate,
        name: holiday.name,
        rateType: 'PERCENT',
        rateValue: 200,
      },
    })
    console.log(`[seed] Created holiday "${holiday.name}" (${holiday.date})`)
  }
}

async function seedEmployees(): Promise<void> {
  const employees = [
    { name: 'Nguyen Van A', phone: '0900000001' },
    { name: 'Tran Thi B', phone: '0900000002' },
  ]

  for (const employee of employees) {
    const existing = await prisma.employee.findFirst({ where: { name: employee.name, source: 'manual' } })
    if (existing) {
      console.log(`[seed] Employee "${employee.name}" already exists, skipping.`)
      continue
    }

    await prisma.employee.create({
      data: {
        name: employee.name,
        phone: employee.phone,
        source: 'manual',
      },
    })
    console.log(`[seed] Created employee "${employee.name}"`)
  }
}

async function main(): Promise<void> {
  await seedAdmin()
  await seedRateBands()
  await seedHolidays()
  await seedEmployees()
}

main()
  .catch((err) => {
    console.error('[seed] Failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
