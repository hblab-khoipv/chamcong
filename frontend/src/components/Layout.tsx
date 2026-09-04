import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Tổng quan' },
  { to: '/employees', label: 'Nhân viên' },
  { to: '/rate-bands', label: 'Khung giờ' },
  { to: '/holidays', label: 'Ngày lễ' },
  { to: '/attendance', label: 'Chấm công' },
  { to: '/attendance/needs-attention', label: 'Cần xử lý' },
  { to: '/reports', label: 'Báo cáo' },
]

export function Layout() {
  const { logout } = useAuth()

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">Chấm Công</span>
        <nav className="app-nav" aria-label="Điều hướng chính">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button type="button" className="btn btn-ghost" onClick={logout}>
          Đăng xuất
        </button>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
