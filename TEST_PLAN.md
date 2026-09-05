# ChamCong — Test Plan (T18: Kiểm thử tổng thể End-to-End)

Consolidated record of what has actually been tested for the main flow —
webhook intake → employee matching → session lifecycle → rate splitting →
admin correction → payroll reporting — with all parts wired together.

Scope note: T17 (real webhook authentication) is intentionally not yet
implemented (deferred, per the PRD). All scenarios below exercise
`POST /webhooks/attendance` exactly as it exists today — accepting any
request matching the payload schema, no signature/token check.

## How to run

```
npm test --workspace=backend
```

Requires a real Postgres reachable via `DATABASE_URL` (see `backend/.env`);
there is no mocked-DB path. `backend/src/tests/e2e.test.ts` holds the T18
end-to-end suite specifically; it runs as part of the same `npm test` run
as every other backend test (same real DB, same CI job — see
`.github/workflows/ci.yml`'s `test-backend` job).

## Rate example used throughout

Seeded default: 3 rate bands covering 24h with no gap, all at
23,000đ/h — Ca 1 (06:00–17:00), Ca 2 (17:00–24:00), Ca 3 (00:00–06:00),
matching the PRD's worked example. A login 09:00 → logout 17:00 on a
normal (non-holiday) day = 8h × 23,000đ = **184,000đ**.

## End-to-end scenarios (`backend/src/tests/e2e.test.ts`)

| # | Scenario | Steps | Expected result | Status |
|---|---|---|---|---|
| 1 | Normal day, single band | Webhook LOGIN 09:00 → webhook LOGOUT 17:00, same day | Session CLOSED, 1 segment, 8h, 184,000đ; `GET /reports/payroll` for that day shows the employee's row at 184,000đ, no unresolved-session warning | ✅ Pass |
| 2 | Holiday (FIXED rate) | `POST /holidays` creates a FIXED=50,000đ/h holiday on a given date → webhook LOGIN 09:00 / LOGOUT 17:00 that same date | Session CLOSED at 8h × 50,000 = 400,000đ (FIXED overrides the band's 23,000đ/h entirely); payroll report reflects 400,000đ for that employee | ✅ Pass |
| 3 | Unknown employee, auto-create off → admin resolves | `AUTO_CREATE_EMPLOYEE_ON_WEBHOOK=false` → webhook LOGIN then LOGOUT for an unrecognized `external_id` → both land as UNMATCHED events, no employee/session created → admin creates the real employee via API and links `external_id` (`PATCH /employees/:id/link-external`) → admin reprocesses both events (`POST /attendance-events/:id/reprocess`) | Both events end PROCESSED and attached to the correct employee; a normal CLOSED session is created (184,000đ); final payroll report shows the correct employee name and amount, `unmatchedEventCount` back to 0 | ✅ Pass |
| 4 | Missed logout, corrected by admin | Webhook LOGIN day 1 09:00 (no logout that day) → webhook LOGIN day 2 09:00 for the same employee → admin fills in day 1's missing `logout_time` via `PATCH /attendance-sessions/:id` → webhook LOGOUT day 2 17:00 | Day-1 session is auto-flagged FLAGGED (missing logout) the moment day-2's LOGIN arrives; after the manual PATCH it becomes MANUAL with 184,000đ; day-2 session closes normally at 184,000đ; payroll report over both days totals 368,000đ with 0 remaining flagged sessions | ✅ Pass |
| 5 | Light concurrent load | 20 pre-existing employees each send one LOGIN webhook concurrently (`Promise.all`, same nominal event time) | All 20 requests succeed; exactly 20 sessions created, one per employee, each OPEN and attributed to its own employee (no cross-employee mixup); all 20 underlying events end PROCESSED — no deadlock, no lost/duplicated event | ✅ Pass |

### Deviations from the literal PRD wording (and why)

- **Scenario 2** uses a fixed calendar date (`2026-09-02`) rather than the
  real wall-clock "today". The mechanic under test — a holiday configured
  for the same calendar day a session falls on — is identical either way;
  a fixed date keeps the test deterministic regardless of when the suite
  runs (consistent with every other date-based test in this repo, which
  all use fixed 2026-xx-xx dates).
- **Scenario 5** pre-creates the 20 employees (rather than relying on
  webhook auto-create) so the assertion isolates the concurrency behavior
  actually named in the requirement — "no session attributed to the wrong
  employee" — from auto-create's own employee-creation race, which is
  already covered separately (see below).

## Supporting coverage exercised by the same run (not new for T18, listed for completeness)

These are covered by existing per-task test files (`backend/src/tests/*.test.ts`)
that this same `npm test` run includes, and that the T18 scenarios above
build on top of:

| Area | Covered by | Status |
|---|---|---|
| Webhook intake: validation, idempotency (`dedupe_key`), 100 sequential requests | `webhooks.test.ts` | ✅ Pass |
| Employee matching/auto-create race (two concurrent first-ever LOGINs for a brand-new `external_id`) | `attendanceEvents.test.ts`, `attendanceSessions.test.ts` | ✅ Pass |
| Session lifecycle races (LOGOUT vs. stale-flag sweep, interleaved employees) | `attendanceSessions.test.ts` | ✅ Pass |
| Rate splitting arithmetic (band boundaries, midnight crossing, PERCENT/FIXED holiday math, rounding) | `rateSplitting.test.ts`, `holidays.test.ts` | ✅ Pass |
| Manual correction validation (overlap, `logout_time <= login_time`), audit logging | `attendanceSessionCorrection.test.ts` | ✅ Pass |
| Payroll aggregation rules (CLOSED+MANUAL count, FLAGGED/OPEN excluded, unmatched-event warning) | `payrollReport.test.ts`, `reports.test.ts` | ✅ Pass |
| Auth/authorization on all admin endpoints | `auth.test.ts` + per-route tests | ✅ Pass |

## Full suite result at time of writing

`npm test --workspace=backend`: **18 test files, 107 tests, all passing**
(includes the 5 T18 end-to-end scenarios above plus all prior task suites,
run against a real Postgres instance per `backend/vitest.config.ts`'s
`globalSetup`).

## Explicitly out of scope for this pass

- **T17** (real webhook signature/token auth, webhook rate limiting) — not
  implemented yet; deferred per the T18 brief. The webhook endpoint is
  tested here exactly as it exists today (unauthenticated).
- Frontend browser-driven E2E (clicking through the actual Admin UI) —
  this plan covers the backend API/webhook path the UI calls into; the
  Admin UI itself already has its own component-level test coverage under
  `frontend/src/`.
