# Chấm Công — Hệ thống chấm công & tính lương partime

Hệ thống tự động nhận sự kiện login/logout từ app quản lý bán hàng qua webhook, tính giờ làm và tiền lương theo khung giờ và ngày lễ cho nhân viên partime.

## Tech stack

| Thành phần | Công nghệ | Phiên bản |
|---|---|---|
| Backend runtime | Node.js | 20 LTS |
| Backend framework | Express | 4.18 |
| ORM / Migration | Prisma | 5.7 |
| Database | PostgreSQL | 15 |
| Frontend framework | React | 18.2 |
| Frontend bundler | Vite | 5.0 |
| Ngôn ngữ | TypeScript | 5.3 |
| Test runner | Vitest | 1.1 |

> **Tại sao TypeScript?** Dự án có data model phức tạp (8 entity, nhiều quan hệ), thuật toán tính lương nhiều bước, và Prisma tích hợp rất tốt với TypeScript. TypeScript giúp bắt lỗi type ngay lúc phát triển thay vì khi chạy.

## Prerequisites

- Node.js 20+
- Docker & Docker Compose
- npm 10+

## Chạy local với Docker (khuyến nghị)

```bash
# 1. Clone hoặc mở thư mục project
cd chamcong

# 2. Copy file biến môi trường
cp .env.example .env

# 3. Khởi động DB + backend
docker compose up

# 4. Kiểm tra health endpoint
curl http://localhost:3000/health
```

## Chạy local không có Docker

```bash
# Cần PostgreSQL chạy sẵn trên máy (port 5432)

# 1. Cài dependencies
npm install

# 2. Copy và điền biến môi trường
cp backend/.env.example backend/.env
# Sửa DATABASE_URL trong backend/.env trỏ tới PostgreSQL của bạn

# 3. Chạy migrations
npm run db:migrate --workspace=backend

# 4. Chạy backend
npm run dev:backend

# 5. Chạy frontend (terminal khác)
npm run dev:frontend
```

## Chạy migrations

```bash
# Chạy migration trên DB (cần DATABASE_URL được set)
npm run db:migrate --workspace=backend

# Seed dữ liệu mẫu (tạo admin mặc định, 3 ca, ngày lễ mẫu)
npm run db:seed --workspace=backend

# Xem schema DB qua UI
npm run db:studio --workspace=backend
```

## Chạy tests

```bash
# Chạy tất cả tests (backend + frontend)
npm test

# Chỉ backend
npm test --workspace=backend

# Chỉ frontend
npm test --workspace=frontend

# Watch mode
npm run test:watch --workspace=backend
```

## Cấu trúc project

```
chamcong/
├── backend/          # Node.js + Express + Prisma API server
│   ├── prisma/       # Schema và migrations
│   └── src/
│       ├── lib/      # Prisma client, utilities, business logic
│       ├── routes/   # Express route handlers
│       └── tests/    # Vitest tests
├── frontend/         # React + Vite admin UI
│   └── src/
├── docker-compose.yml
└── .env.example
```

## Endpoints hiện có

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | /health | Không | Kiểm tra trạng thái server và DB |
| POST | /auth/login | Không | Đăng nhập, trả JWT |
| POST | /auth/logout | Có | Đăng xuất (JWT stateless, chỉ là formality) |
| GET | /admins | Có | Danh sách Admin |
| POST | /admins | Có | Tạo Admin mới |
| DELETE | /admins/:id | Có | Xoá Admin (chặn nếu là Admin cuối cùng) |
| PATCH | /admins/:id/password | Có | Đổi mật khẩu Admin |
| GET | /employees | Có | Danh sách nhân viên (filter `source`, `active`, `name`) |
| POST | /employees | Có | Tạo nhân viên thủ công |
| PATCH | /employees/:id | Có | Sửa nhân viên |
| DELETE | /employees/:id | Có | Vô hiệu hoá nhân viên (soft-delete) |
| PATCH | /employees/:id/link-external | Có | Gán `external_id` cho nhân viên thủ công |
| GET | /rate-bands | Có | Danh sách khung giờ tính giá (filter `active`) |
| GET | /rate-bands/coverage | Có | Bản đồ phủ 24h + danh sách gap chưa phủ |
| POST | /rate-bands | Có | Tạo khung giờ mới (chặn nếu chồng lấn với band active khác) |
| PATCH | /rate-bands/:id | Có | Sửa khung giờ |
| DELETE | /rate-bands/:id | Có | Xoá khung giờ (hard-delete nếu chưa dùng, soft-delete nếu đã có segment tham chiếu) |
| GET | /holidays | Có | Danh sách ngày lễ (filter `year`) |
| POST | /holidays | Có | Tạo ngày lễ (chặn trùng `holiday_date`) |
| PATCH | /holidays/:id | Có | Sửa ngày lễ |
| DELETE | /holidays/:id | Có | Vô hiệu hoá ngày lễ (soft-delete/deactivate) |
| POST | /webhooks/attendance | Không | Nhận sự kiện login/logout từ app bán hàng (xác thực sẽ làm ở T17) |
| GET | /attendance-events/unmatched | Có | Danh sách sự kiện chưa khớp được nhân viên |
| POST | /attendance-events/:id/reprocess | Có | Xử lý lại một sự kiện sau khi đã gán `external_id` |
| GET | /attendance-sessions | Có | Danh sách phiên chấm công (filter `status`, `employeeId`) |
| PATCH | /attendance-sessions/:id | Có | Sửa `login_time`/`logout_time`, tính lại segment (T9) |
| POST | /attendance-sessions/:id/recompute | Có | Tính lại segment theo cấu hình hiện tại (yêu cầu `{ confirm: true }`) |

Auth: gửi header `Authorization: Bearer <token>` (token nhận từ `POST /auth/login`).

Xem thêm data model tại [`docs/ERD.md`](docs/ERD.md).

## Development roadmap

Xem `PRD/PRD_ChamCong_TaskBreakdown.md` để biết chi tiết từng task và thứ tự thực hiện.

- [x] T0 — Khởi tạo project & môi trường
- [x] T1 — Thiết kế & migration schema dữ liệu
- [x] T2 — Xác thực Admin
- [x] T3 — Quản lý Nhân viên
- [x] T4 — Quản lý Khung giờ tính giá
- [x] T5 — Quản lý Ngày lễ
- [x] T6 — Webhook nhận sự kiện chấm công
- [x] T7 — Khớp nhân viên
- [x] T8 — Vòng đời phiên chấm công
- [x] T9 — Rate Splitting Engine
- [x] T10 — Trigger tính toán
- [x] T11 — Sửa tay & tính lại
- [ ] T12–T16 — Giao diện Admin
- [ ] T17–T19 — Vận hành & triển khai
