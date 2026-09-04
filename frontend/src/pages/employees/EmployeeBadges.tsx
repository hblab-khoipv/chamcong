import type { Employee } from '../../api/types'

// The link-external endpoint (T3) does not flip `source` from 'manual' to
// 'synced' -- it only sets externalId. We show the "synced" badge based on
// externalId presence so a manually-created employee that gets linked
// immediately reads as synced (T13 required test case), without relying on
// a backend field that the API intentionally never mutates here.
export function SyncBadge({ employee }: { employee: Employee }) {
  const isSynced = employee.externalId !== null
  return (
    <span className={isSynced ? 'badge badge-synced' : 'badge badge-manual'}>
      {isSynced ? 'Đã đồng bộ' : 'Thủ công'}
    </span>
  )
}

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span className={active ? 'badge badge-active' : 'badge badge-inactive'}>
      {active ? 'Đang hoạt động' : 'Đã vô hiệu hoá'}
    </span>
  )
}
