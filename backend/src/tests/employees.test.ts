import request, { Response } from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { prisma } from '../lib/db'
import { createTestAdmin, TestAdmin } from './testUtils/auth'
import { resetDb } from './testUtils/db'

const app = createApp()

describe('T3 employee CRUD', () => {
  let admin: TestAdmin

  beforeEach(async () => {
    await resetDb()
    admin = await createTestAdmin()
  })

  afterAll(async () => {
    await resetDb()
  })

  function get(path: string): request.Test {
    return request(app).get(path).set('Authorization', `Bearer ${admin.token}`)
  }
  function post(path: string): request.Test {
    return request(app).post(path).set('Authorization', `Bearer ${admin.token}`)
  }
  function patch(path: string): request.Test {
    return request(app).patch(path).set('Authorization', `Bearer ${admin.token}`)
  }
  function del(path: string): request.Test {
    return request(app).delete(path).set('Authorization', `Bearer ${admin.token}`)
  }

  it('creates a manual employee with source=manual and external_id=null', async () => {
    const res = await post('/employees').send({ name: 'Nguyen Van A', phone: '0900000001' })

    expect(res.status).toBe(201)
    expect(res.body.employee.source).toBe('manual')
    expect(res.body.employee.externalId).toBeNull()
    expect(res.body.employee.name).toBe('Nguyen Van A')
  })

  // T3 test case: "Tạo nhân viên với external_id trùng nhân viên đã có → lỗi 409."
  // POST /employees never accepts external_id directly (Phạm vi #2 forces it to
  // null for manual creation) — the only way to attach one is link-external, so
  // that's the surface this duplicate-external_id case is exercised through.
  it('rejects assigning an external_id already used by another employee -> 409', async () => {
    const empA = (await post('/employees').send({ name: 'Emp A' })) as Response
    const empB = (await post('/employees').send({ name: 'Emp B' })) as Response

    const linkA = await patch(`/employees/${empA.body.employee.id}/link-external`).send({ external_id: 'EXT-1' })
    expect(linkA.status).toBe(200)
    expect(linkA.body.employee.externalId).toBe('EXT-1')

    const linkB = await patch(`/employees/${empB.body.employee.id}/link-external`).send({ external_id: 'EXT-1' })
    expect(linkB.status).toBe(409)
  })

  it('soft-deletes an employee: disappears from the active list but stays queryable', async () => {
    const created = (await post('/employees').send({ name: 'To Deactivate' })) as Response
    const id = created.body.employee.id

    const deleted = await del(`/employees/${id}`)
    expect(deleted.status).toBe(200)
    expect(deleted.body.employee.active).toBe(false)

    const activeList = await get('/employees?active=true')
    expect(activeList.body.employees.find((e: { id: string }) => e.id === id)).toBeUndefined()

    const allList = await get('/employees')
    expect(allList.body.employees.find((e: { id: string }) => e.id === id)).toBeDefined()
  })

  it('links external_id for a manual employee successfully', async () => {
    const created = (await post('/employees').send({ name: 'Linkable' })) as Response
    const id = created.body.employee.id

    const res = await patch(`/employees/${id}/link-external`).send({ external_id: 'EXT-LINK-1' })

    expect(res.status).toBe(200)
    expect(res.body.employee.externalId).toBe('EXT-LINK-1')
  })

  it('filters by source, by active, and searches by name', async () => {
    await prisma.employee.create({ data: { name: 'Synced One', source: 'synced', externalId: 'S1', active: true } })
    await prisma.employee.create({ data: { name: 'Manual Two', source: 'manual', active: true } })
    await prisma.employee.create({ data: { name: 'Manual Inactive', source: 'manual', active: false } })

    const bySource = await get('/employees?source=synced')
    expect(bySource.body.employees).toHaveLength(1)
    expect(bySource.body.employees[0].name).toBe('Synced One')

    const byActive = await get('/employees?active=false')
    expect(byActive.body.employees).toHaveLength(1)
    expect(byActive.body.employees[0].name).toBe('Manual Inactive')

    const byName = await get('/employees?name=manual')
    expect(byName.body.employees.map((e: { name: string }) => e.name).sort()).toEqual([
      'Manual Inactive',
      'Manual Two',
    ])
  })
})
