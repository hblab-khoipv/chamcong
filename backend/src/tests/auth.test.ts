import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { prisma } from '../lib/db'
import { MAX_ATTEMPTS, resetAllAttemptsForTests } from '../middleware/loginRateLimit'
import { createTestAdmin } from './testUtils/auth'
import { resetDb } from './testUtils/db'

const app = createApp()

describe('T2 admin auth', () => {
  beforeEach(async () => {
    await resetDb()
    resetAllAttemptsForTests()
  })

  afterAll(async () => {
    await resetDb()
  })

  it('logs in successfully with the correct email/password', async () => {
    const admin = await createTestAdmin()

    const res = await request(app).post('/auth/login').send({ email: admin.email, password: admin.password })

    expect(res.status).toBe(200)
    expect(typeof res.body.token).toBe('string')
  })

  it('rejects login with the wrong password -> 401', async () => {
    const admin = await createTestAdmin()

    const res = await request(app).post('/auth/login').send({ email: admin.email, password: 'totally-wrong' })

    expect(res.status).toBe(401)
  })

  it('rejects calling an auth-required endpoint without a token -> 401', async () => {
    const res = await request(app).get('/admins')
    expect(res.status).toBe(401)
  })

  it('rejects calling an auth-required endpoint with an invalid token -> 401', async () => {
    const res = await request(app).get('/admins').set('Authorization', 'Bearer not-a-real-token')
    expect(res.status).toBe(401)
  })

  it('creates a new admin who can log in immediately', async () => {
    const admin = await createTestAdmin()

    const createRes = await request(app)
      .post('/admins')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ email: 'newadmin@test.local', password: 'new-admin-password', name: 'New Admin' })

    expect(createRes.status).toBe(201)

    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email: 'newadmin@test.local', password: 'new-admin-password' })

    expect(loginRes.status).toBe(200)
    expect(typeof loginRes.body.token).toBe('string')
  })

  it('blocks deleting the last remaining admin', async () => {
    const admin = await createTestAdmin()

    const res = await request(app).delete(`/admins/${admin.id}`).set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(409)

    const stillExists = await prisma.admin.findUnique({ where: { id: admin.id } })
    expect(stillExists).not.toBeNull()
  })

  it(`locks out login after ${MAX_ATTEMPTS} consecutive failed attempts, even with the correct password on the next try`, async () => {
    const admin = await createTestAdmin()

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const res = await request(app).post('/auth/login').send({ email: admin.email, password: 'wrong-password' })
      expect(res.status).toBe(401)
    }

    const res = await request(app).post('/auth/login').send({ email: admin.email, password: admin.password })
    expect(res.status).toBe(429)
  })

  it('changes password successfully; the old password no longer logs in', async () => {
    const admin = await createTestAdmin()

    const changeRes = await request(app)
      .patch(`/admins/${admin.id}/password`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ password: 'brand-new-password' })

    expect(changeRes.status).toBe(200)

    const oldLoginRes = await request(app).post('/auth/login').send({ email: admin.email, password: admin.password })
    expect(oldLoginRes.status).toBe(401)

    const newLoginRes = await request(app)
      .post('/auth/login')
      .send({ email: admin.email, password: 'brand-new-password' })
    expect(newLoginRes.status).toBe(200)
  })
})
