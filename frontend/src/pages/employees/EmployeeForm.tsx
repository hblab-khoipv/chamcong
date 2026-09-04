import { FormEvent, useState } from 'react'
import type { Employee } from '../../api/types'

interface EmployeeFormProps {
  employee: Employee | null
  onSubmit: (input: { name: string; phone: string }) => Promise<void>
  onCancel: () => void
}

export function EmployeeForm({ employee, onSubmit, onCancel }: EmployeeFormProps) {
  const [name, setName] = useState(employee?.name ?? '')
  const [phone, setPhone] = useState(employee?.phone ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit({ name, phone })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Có lỗi xảy ra.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="form-panel" onSubmit={handleSubmit}>
      <h2>{employee ? 'Sửa nhân viên' : 'Thêm nhân viên'}</h2>
      <div className="form-row">
        <label htmlFor="employee-name">Tên</label>
        <input id="employee-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="form-row">
        <label htmlFor="employee-phone">Số điện thoại</label>
        <input id="employee-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {employee ? 'Lưu' : 'Thêm'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Huỷ
        </button>
      </div>
    </form>
  )
}
