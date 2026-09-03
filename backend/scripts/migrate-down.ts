// Applies the hand-written down.sql for a migration, reverting it, then
// removes its bookkeeping row from `_prisma_migrations` so a subsequent
// `prisma migrate deploy` can re-apply it cleanly.
//
// Usage:
//   tsx scripts/migrate-down.ts [migrationName] [--schema <name>]
//
// Defaults to the most recently created migration when no name is given.
// `--schema` targets a non-default Postgres schema (used by tests that run
// the up/down cycle in an isolated schema instead of the shared test DB).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import 'dotenv/config'
import { Client } from 'pg'

function parseArgs(argv: string[]): { schema?: string; migrationName?: string } {
  let schema: string | undefined
  let migrationName: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--schema') {
      schema = argv[i + 1]
      i++
    } else {
      migrationName = argv[i]
    }
  }
  return { schema, migrationName }
}

function latestMigrationName(migrationsDir: string): string {
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  if (dirs.length === 0) {
    throw new Error('No migrations found under prisma/migrations')
  }
  return dirs[dirs.length - 1]
}

async function main(): Promise<void> {
  const migrationsDir = join(__dirname, '..', 'prisma', 'migrations')
  const { schema, migrationName } = parseArgs(process.argv.slice(2))
  const target = migrationName ?? latestMigrationName(migrationsDir)
  const downSqlPath = join(migrationsDir, target, 'down.sql')

  if (!existsSync(downSqlPath)) {
    throw new Error(`No down.sql found for migration "${target}" at ${downSqlPath}`)
  }

  const sql = readFileSync(downSqlPath, 'utf-8')
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  try {
    if (schema) {
      await client.query(`SET search_path TO "${schema}"`)
    }
    await client.query(sql)
    await client.query('DELETE FROM "_prisma_migrations" WHERE migration_name = $1', [target])
    console.log(`[migrate-down] Reverted migration "${target}"${schema ? ` in schema "${schema}"` : ''}`)
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('[migrate-down] Failed:', err)
  process.exit(1)
})
