// T1 acceptance: "Chạy migration từ DB rỗng thành công, rollback được (down
// migration)." Runs the up/down cycle in an isolated Postgres schema so it
// doesn't disturb the shared `public` schema other integration tests use.
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

const EXPECTED_TABLES = [
  'admins',
  'employees',
  'rate_bands',
  'holidays',
  'attendance_events',
  'attendance_sessions',
  'attendance_session_segments',
  'audit_logs',
  'webhook_logs',
]

const BACKEND_DIR = join(__dirname, '..', '..')

async function tablesInSchema(baseUrl: string, schema: string): Promise<string[]> {
  const client = new Client({ connectionString: baseUrl })
  await client.connect()
  try {
    const result = await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema = $1', [
      schema,
    ])
    return result.rows.map((row) => row.table_name as string)
  } finally {
    await client.end()
  }
}

describe('T1 migration up/down', () => {
  const baseUrl = process.env.DATABASE_URL as string
  const schemaName = `migtest_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const schemaUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}schema=${schemaName}`

  afterAll(async () => {
    const client = new Client({ connectionString: baseUrl })
    await client.connect()
    await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await client.end()
  })

  it('applies all migrations to a clean schema, then rolls back cleanly via down.sql', async () => {
    const setupClient = new Client({ connectionString: baseUrl })
    await setupClient.connect()
    await setupClient.query(`CREATE SCHEMA "${schemaName}"`)
    await setupClient.end()

    execSync('npx prisma migrate deploy', {
      cwd: BACKEND_DIR,
      env: { ...process.env, DATABASE_URL: schemaUrl },
      stdio: 'pipe',
    })

    const tablesAfterUp = await tablesInSchema(baseUrl, schemaName)
    for (const table of EXPECTED_TABLES) {
      expect(tablesAfterUp).toContain(table)
    }

    execSync(`npx tsx scripts/migrate-down.ts --schema ${schemaName}`, {
      cwd: BACKEND_DIR,
      env: { ...process.env, DATABASE_URL: baseUrl },
      stdio: 'pipe',
    })

    const tablesAfterDown = await tablesInSchema(baseUrl, schemaName)
    for (const table of EXPECTED_TABLES) {
      expect(tablesAfterDown).not.toContain(table)
    }
  }, 30000)
})
