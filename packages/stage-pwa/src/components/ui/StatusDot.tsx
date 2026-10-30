import { useTranslation } from 'react-i18next'
export type Status = 'ok' | 'warning' | 'error' | 'off'

const COLOR: Record<Status, string> = { ok: 'bg-ok', warning: 'bg-warn', error: 'bg-danger', off: 'bg-control-strong' }

/** One size, four states - red only for faults. */
export function StatusDot({ status, label }: { status: Status; label?: string }) {
  const { t } = useTranslation('common')
  return <span role="img" aria-label={label ?? t(`ui.status.${status}`)} className={`inline-block h-3 w-3 flex-shrink-0 rounded-full ${COLOR[status]}`} />
}
