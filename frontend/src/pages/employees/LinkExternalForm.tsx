import { FormEvent, useState } from 'react'

interface LinkExternalFormProps {
  onSubmit: (externalId: string) => Promise<void>
  onCancel: () => void
}

export function LinkExternalForm({ onSubmit, onCancel }: LinkExternalFormProps) {
  const [externalId, setExternalId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit(externalId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Có lỗi xảy ra.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="link-external-form" onSubmit={handleSubmit} aria-label="Liên kết mã nhân viên">
      <input
        aria-label="Mã nhân viên (external_id)"
        placeholder="Mã nhân viên bên app bán hàng"
        value={externalId}
        onChange={(e) => setExternalId(e.target.value)}
        required
      />
      <button type="submit" className="btn btn-primary btn-small" disabled={submitting}>
        Liên kết
      </button>
      <button type="button" className="btn btn-secondary btn-small" onClick={onCancel}>
        Huỷ
      </button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </form>
  )
}
