import { useEffect, useState } from 'react'
import { employeesApi } from '../../api/endpoints'
import { ApiError } from '../../api/client'
import type { Employee } from '../../api/types'
import { EmployeeForm } from './EmployeeForm'
import { LinkExternalForm } from './LinkExternalForm'
import { ActiveBadge, SyncBadge } from './EmployeeBadges'

type ActiveFilter = 'all' | 'active' | 'inactive'

export function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('active')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    employeesApi
      .list()
      .then(({ employees: list }) => {
        if (!cancelled) setEmployees(list)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : 'Không tải được danh sách nhân viên.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function upsertLocal(employee: Employee) {
    setEmployees((prev) => {
      const exists = prev.some((e) => e.id === employee.id)
      return exists ? prev.map((e) => (e.id === employee.id ? employee : e)) : [...prev, employee]
    })
  }

  async function handleCreate(input: { name: string; phone: string }) {
    const { employee } = await employeesApi.create({ name: input.name, phone: input.phone || null })
    upsertLocal(employee)
    setShowCreateForm(false)
    setMessage(`Đã thêm nhân viên "${employee.name}".`)
  }

  async function handleEditSave(input: { name: string; phone: string }) {
    if (!editingEmployee) return
    const { employee } = await employeesApi.update(editingEmployee.id, { name: input.name, phone: input.phone || null })
    upsertLocal(employee)
    setEditingEmployee(null)
    setMessage(`Đã cập nhật nhân viên "${employee.name}".`)
  }

  async function handleDeactivate(employee: Employee) {
    setActionError(null)
    try {
      const { employee: updated } = await employeesApi.deactivate(employee.id)
      upsertLocal(updated)
      setMessage(`Đã vô hiệu hoá nhân viên "${updated.name}".`)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Không thể vô hiệu hoá nhân viên.')
    }
  }

  async function handleReactivate(employee: Employee) {
    setActionError(null)
    try {
      const { employee: updated } = await employeesApi.update(employee.id, { active: true })
      upsertLocal(updated)
      setMessage(`Đã kích hoạt lại nhân viên "${updated.name}".`)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Không thể kích hoạt nhân viên.')
    }
  }

  async function handleLinkExternal(employee: Employee, externalId: string) {
    const { employee: updated } = await employeesApi.linkExternal(employee.id, externalId)
    upsertLocal(updated)
    setLinkingId(null)
    setMessage(`Đã liên kết mã nhân viên cho "${updated.name}" — đã đồng bộ.`)
  }

  const visibleEmployees = employees.filter((e) => {
    if (activeFilter === 'active') return e.active
    if (activeFilter === 'inactive') return !e.active
    return true
  })

  if (loading) return <p>Đang tải...</p>
  if (loadError) return <p role="alert" className="form-error">{loadError}</p>

  return (
    <div>
      <h1>Nhân viên</h1>

      {message && <p className="form-success">{message}</p>}
      {actionError && (
        <p role="alert" className="form-error">
          {actionError}
        </p>
      )}

      <div className="filters-row">
        <div className="form-row">
          <label htmlFor="active-filter">Trạng thái</label>
          <select
            id="active-filter"
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}
          >
            <option value="active">Đang hoạt động</option>
            <option value="inactive">Đã vô hiệu hoá</option>
            <option value="all">Tất cả</option>
          </select>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setShowCreateForm((v) => !v)
            setEditingEmployee(null)
          }}
        >
          {showCreateForm ? 'Đóng' : 'Thêm nhân viên'}
        </button>
      </div>

      {showCreateForm && (
        <EmployeeForm employee={null} onSubmit={handleCreate} onCancel={() => setShowCreateForm(false)} />
      )}
      {editingEmployee && (
        <EmployeeForm
          key={editingEmployee.id}
          employee={editingEmployee}
          onSubmit={handleEditSave}
          onCancel={() => setEditingEmployee(null)}
        />
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>Tên</th>
            <th>SĐT</th>
            <th>Nguồn</th>
            <th>Trạng thái</th>
            <th>Hành động</th>
          </tr>
        </thead>
        <tbody>
          {visibleEmployees.map((employee) => (
            <tr key={employee.id}>
              <td>{employee.name}</td>
              <td>{employee.phone ?? '—'}</td>
              <td>
                <SyncBadge employee={employee} />
              </td>
              <td>
                <ActiveBadge active={employee.active} />
              </td>
              <td>
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() => {
                      setShowCreateForm(false)
                      setEditingEmployee(employee)
                    }}
                  >
                    Sửa
                  </button>
                  {employee.active ? (
                    <button type="button" className="btn btn-danger btn-small" onClick={() => handleDeactivate(employee)}>
                      Vô hiệu hoá
                    </button>
                  ) : (
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => handleReactivate(employee)}>
                      Kích hoạt
                    </button>
                  )}
                  {employee.externalId === null &&
                    (linkingId === employee.id ? (
                      <LinkExternalForm
                        onSubmit={(externalId) => handleLinkExternal(employee, externalId)}
                        onCancel={() => setLinkingId(null)}
                      />
                    ) : (
                      <button type="button" className="btn btn-ghost btn-small" onClick={() => setLinkingId(employee.id)}>
                        Liên kết mã NV
                      </button>
                    ))}
                </div>
              </td>
            </tr>
          ))}
          {visibleEmployees.length === 0 && (
            <tr>
              <td colSpan={5}>Không có nhân viên phù hợp.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
