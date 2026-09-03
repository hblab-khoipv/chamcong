import { prisma } from '../../lib/db'
import { signAdminToken } from '../../lib/jwt'
import { hashPassword } from '../../lib/password'

export interface TestAdmin {
  id: string
  email: string
  name: string
  password: string
  token: string
}

let counter = 0

export async function createTestAdmin(overrides: Partial<{ email: string; password: string; name: string }> = {}): Promise<TestAdmin> {
  counter += 1
  const email = overrides.email ?? `admin${counter}@test.local`
  const password = overrides.password ?? 'correct-horse-battery-staple'
  const name = overrides.name ?? `Test Admin ${counter}`

  const passwordHash = await hashPassword(password)
  const admin = await prisma.admin.create({ data: { email, passwordHash, name } })
  const token = signAdminToken({ sub: admin.id, email: admin.email })

  return { id: admin.id, email: admin.email, name: admin.name, password, token }
}
