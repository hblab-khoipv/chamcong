import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../lib/db'
import { resetDb } from './testUtils/db'

const BACKEND_DIR = join(__dirname, '..', '..')

function runSeed(): void {
  execSync('npx tsx prisma/seed.ts', {
    cwd: BACKEND_DIR,
    env: process.env,
    stdio: 'pipe',
  })
}

async function counts() {
  const [admins, rateBands, holidays, employees] = await Promise.all([
    prisma.admin.count(),
    prisma.rateBand.count(),
    prisma.holiday.count(),
    prisma.employee.count(),
  ])
  return { admins, rateBands, holidays, employees }
}

describe('T1 seed script', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await resetDb()
  })

  it('creates the expected number of records on first run', async () => {
    runSeed()

    const result = await counts()
    expect(result).toEqual({ admins: 1, rateBands: 3, holidays: 4, employees: 2 })
  }, 20000)

  it('is idempotent: running it again does not error or duplicate records', async () => {
    runSeed()
    expect(() => runSeed()).not.toThrow()

    const result = await counts()
    expect(result).toEqual({ admins: 1, rateBands: 3, holidays: 4, employees: 2 })
  }, 20000)
})
