import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { prisma } from '../lib/db'
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

describe('T6 webhook attendance ingestion', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await resetDb()
  })

  // T6 test case: "Webhook payload hợp lệ, không kèm header xác thực nào ->
  // 200 + event được lưu."
  it('accepts a valid payload with no auth header -> 200, creates exactly 1 attendance_event', async () => {
    const res = await request(app).post('/webhooks/attendance').send(validPayload())

    expect(res.status).toBe(200)

    const events = await prisma.attendanceEvent.findMany()
    expect(events).toHaveLength(1)
    expect(events[0].dedupeKey).toBe('evt_abc123')
    expect(events[0].employeeExternalId).toBe('EMP001')

    const logs = await prisma.webhookLog.findMany()
    expect(logs).toHaveLength(1)
    expect(logs[0].resultStatus).toBe('accepted')
  })

  // T6 test case: "Webhook gửi trùng event_id -> idempotent, không tạo 2
  // bản ghi."
  it('is idempotent on a repeated event_id -> still 1 attendance_event, second call still 200', async () => {
    const first = await request(app).post('/webhooks/attendance').send(validPayload())
    expect(first.status).toBe(200)

    const second = await request(app)
      .post('/webhooks/attendance')
      .send(validPayload({ event_type: 'LOGOUT', event_time: '2026-08-30T17:00:00+07:00' }))
    expect(second.status).toBe(200)
    expect(second.body.status).toBe('duplicate')

    const events = await prisma.attendanceEvent.findMany()
    expect(events).toHaveLength(1)
  })

  // T6 acceptance criteria: "Payload thiếu event_type hoặc event_time ->
  // 400, log lại lỗi."
  it('rejects a payload missing event_time -> 400', async () => {
    const payload = validPayload()
    delete (payload as Record<string, unknown>).event_time

    const res = await request(app).post('/webhooks/attendance').send(payload)
    expect(res.status).toBe(400)

    const events = await prisma.attendanceEvent.findMany()
    expect(events).toHaveLength(0)

    const logs = await prisma.webhookLog.findMany()
    expect(logs).toHaveLength(1)
    expect(logs[0].resultStatus).toBe('error')
  })

  it('rejects a payload missing event_type -> 400', async () => {
    const payload = validPayload()
    delete (payload as Record<string, unknown>).event_type

    const res = await request(app).post('/webhooks/attendance').send(payload)
    expect(res.status).toBe(400)

    const events = await prisma.attendanceEvent.findMany()
    expect(events).toHaveLength(0)
  })

  // T6 test case: "Webhook với event_type không hợp lệ (không phải
  // LOGIN/LOGOUT) -> 400."
  it('rejects an invalid event_type -> 400', async () => {
    const res = await request(app).post('/webhooks/attendance').send(validPayload({ event_type: 'PING' }))
    expect(res.status).toBe(400)

    const events = await prisma.attendanceEvent.findMany()
    expect(events).toHaveLength(0)
  })

  // T6 test case: "Webhook payload rất lớn/field lạ thừa -> hệ thống bỏ qua
  // field thừa, không crash."
  it('ignores unexpected extra fields on a large payload without crashing', async () => {
    const res = await request(app)
      .post('/webhooks/attendance')
      .send(
        validPayload({
          extra_field_one: 'x'.repeat(5000),
          nested: { some: 'thing', arr: [1, 2, 3] },
        })
      )
    expect(res.status).toBe(200)

    const events = await prisma.attendanceEvent.findMany()
    expect(events).toHaveLength(1)
  })

  // T6 test case: "Test hiệu năng đơn giản: 100 request liên tiếp không làm
  // timeout endpoint."
  it(
    'handles 100 sequential requests without timing out the endpoint',
    async () => {
      for (let i = 0; i < 100; i++) {
        const res = await request(app)
          .post('/webhooks/attendance')
          .send(validPayload({ event_id: `evt_perf_${i}`, employee_external_id: `EMP_PERF_${i % 5}` }))
        expect(res.status).toBe(200)
      }

      const events = await prisma.attendanceEvent.findMany()
      expect(events).toHaveLength(100)
    },
    30000
  )
})
