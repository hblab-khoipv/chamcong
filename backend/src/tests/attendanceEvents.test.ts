import request, { Response } from 'supertest'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { prisma } from '../lib/db'
import { createTestAdmin, TestAdmin } from './testUtils/auth'
import { resetDb } from './testUtils/db'

const app = createApp()

function validPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    employee_external_id: 'EMP001',
    employee_name: 'Nguyen Van A',
    event_type: 'LOGIN',
    event_time: '2026-08-30T09:02:15+07:00',
    event_id: 'evt_abc123',
    ...overrides,
  }
}

function webhook(payload: Record<string, unknown>): request.Test {
  return request(app).post('/webhooks/attendance').send(payload)
}

describe('T7 employee matching/resolution', () => {
  let admin: TestAdmin
  const originalAutoCreate = process.env.AUTO_CREATE_EMPLOYEE_ON_WEBHOOK

  beforeEach(async () => {
    await resetDb()
    admin = await createTestAdmin()
  })

  afterEach(() => {
    if (originalAutoCreate === undefined) delete process.env.AUTO_CREATE_EMPLOYEE_ON_WEBHOOK
    else process.env.AUTO_CREATE_EMPLOYEE_ON_WEBHOOK = originalAutoCreate
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

  // T7 test case: "Event với external_id đã tồn tại -> match đúng employee
  // ngay."
  it('matches an event to an existing employee by external_id', async () => {
    const employee = await prisma.employee.create({
      data: { externalId: 'EMP_EXISTING', name: 'Existing Emp', source: 'manual' },
    })

    const res = await webhook(validPayload({ employee_external_id: 'EMP_EXISTING' }))
    expect(res.status).toBe(200)

    const event = await prisma.attendanceEvent.findFirstOrThrow({ where: { employeeExternalId: 'EMP_EXISTING' } })
    expect(event.processStatus).toBe('PROCESSED')
    expect(event.employeeId).toBe(employee.id)
  })

  // T7 test case: "Auto-create bật: webhook login với external_id chưa
  // từng thấy -> employee mới được tạo, session mở tương ứng."
  it('auto-create enabled (default): an unseen external_id creates a synced employee and opens a session', async () => {
    const res = await webhook(validPayload({ employee_external_id: 'EMP_NEW_1', event_type: 'LOGIN' }))
    expect(res.status).toBe(200)

    const employee = await prisma.employee.findUniqueOrThrow({ where: { externalId: 'EMP_NEW_1' } })
    expect(employee.source).toBe('synced')
    expect(employee.active).toBe(true)
    expect(employee.name).toBe('Nguyen Van A')

    const session = await prisma.attendanceSession.findFirstOrThrow({ where: { employeeId: employee.id } })
    expect(session.status).toBe('OPEN')

    const event = await prisma.attendanceEvent.findFirstOrThrow({ where: { employeeExternalId: 'EMP_NEW_1' } })
    expect(event.processStatus).toBe('PROCESSED')
  })

  // T7 test case: "Auto-create tắt: webhook login với external_id chưa
  // từng thấy -> event ở trạng thái UNMATCHED, xuất hiện trong GET
  // /attendance-events/unmatched."
  it('auto-create disabled: an unseen external_id stays UNMATCHED and is listed in /attendance-events/unmatched', async () => {
    process.env.AUTO_CREATE_EMPLOYEE_ON_WEBHOOK = 'false'

    const res = await webhook(validPayload({ employee_external_id: 'EMP_NEW_2' }))
    expect(res.status).toBe(200)

    const event = await prisma.attendanceEvent.findFirstOrThrow({ where: { employeeExternalId: 'EMP_NEW_2' } })
    expect(event.processStatus).toBe('UNMATCHED')

    const employee = await prisma.employee.findUnique({ where: { externalId: 'EMP_NEW_2' } })
    expect(employee).toBeNull()

    const sessions = await prisma.attendanceSession.findMany()
    expect(sessions).toHaveLength(0)

    const unmatchedRes = await get('/attendance-events/unmatched')
    expect(unmatchedRes.status).toBe(200)
    expect(unmatchedRes.body.attendanceEvents.some((e: { id: string }) => e.id === event.id)).toBe(true)
  })

  // T7 test case: "Link external_id cho employee manual có sẵn rồi
  // reprocess event UNMATCHED cũ -> event xử lý thành công, gắn đúng
  // employee đã link."
  it('reprocessing an UNMATCHED event after linking its external_id matches the employee and opens a session', async () => {
    process.env.AUTO_CREATE_EMPLOYEE_ON_WEBHOOK = 'false'
    const webhookRes = (await webhook(validPayload({ employee_external_id: 'EMP_LINK_ME' }))) as Response
    expect(webhookRes.status).toBe(200)

    let event = await prisma.attendanceEvent.findFirstOrThrow({ where: { employeeExternalId: 'EMP_LINK_ME' } })
    expect(event.processStatus).toBe('UNMATCHED')

    process.env.AUTO_CREATE_EMPLOYEE_ON_WEBHOOK = originalAutoCreate

    const manualEmployee = await prisma.employee.create({
      data: { name: 'Manual Emp', source: 'manual', active: true },
    })
    const linkRes = await patch(`/employees/${manualEmployee.id}/link-external`).send({ external_id: 'EMP_LINK_ME' })
    expect(linkRes.status).toBe(200)

    const reprocessRes = await post(`/attendance-events/${event.id}/reprocess`)
    expect(reprocessRes.status).toBe(200)
    expect(reprocessRes.body.attendanceEvent.processStatus).toBe('PROCESSED')
    expect(reprocessRes.body.attendanceEvent.employeeId).toBe(manualEmployee.id)

    event = await prisma.attendanceEvent.findUniqueOrThrow({ where: { id: event.id } })
    expect(event.processStatus).toBe('PROCESSED')

    const session = await prisma.attendanceSession.findFirstOrThrow({ where: { employeeId: manualEmployee.id } })
    expect(session.status).toBe('OPEN')
  })

  // T7 test case: "Employee đã bị active=false nhưng vẫn còn webhook gửi
  // tới -> event vẫn được ghi nhận nhưng có cảnh báo 'nhân viên không còn
  // hoạt động' (mặc định: vẫn ghi nhận + cảnh báo)."
  it('records the event and warns when the matched employee is inactive, without rejecting it', async () => {
    const employee = await prisma.employee.create({
      data: { externalId: 'EMP_INACTIVE', name: 'Inactive Guy', source: 'manual', active: false },
    })

    const res = await webhook(validPayload({ employee_external_id: 'EMP_INACTIVE' }))
    expect(res.status).toBe(200)

    const event = await prisma.attendanceEvent.findFirstOrThrow({ where: { employeeExternalId: 'EMP_INACTIVE' } })
    expect(event.processStatus).toBe('PROCESSED')
    expect(event.employeeId).toBe(employee.id)

    const warningLog = await prisma.auditLog.findFirst({
      where: { entityId: event.id, action: 'attendance_event_inactive_employee_warning' },
    })
    expect(warningLog).not.toBeNull()

    const session = await prisma.attendanceSession.findFirstOrThrow({ where: { employeeId: employee.id } })
    expect(session.status).toBe('OPEN')
  })
})
