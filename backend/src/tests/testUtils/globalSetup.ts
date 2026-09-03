// Runs once before the whole test suite: applies migrations to whatever
// Postgres DATABASE_URL points at (the CI postgres service, or a local test
// DB started manually for dev). Integration tests assume this schema exists.
import { execSync } from 'node:child_process'
import 'dotenv/config'

export default function setup(): void {
  execSync('npx prisma migrate deploy', { stdio: 'inherit' })
}
