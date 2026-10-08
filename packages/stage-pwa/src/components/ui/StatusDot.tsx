export type Status = 'ok' | 'warning' | 'error' | 'off'

const COLOR: Record<Status, string> = { ok: 'bg-green-500', warning: 'bg-amber-500', error: 'bg-red-500', off: 'bg-control-strong' }
const NAME: Record<Status, string> = { ok: 'OK', warning: 'Warnung', error: 'Fehler', off: 'Aus' }

/** One size, four states - red only for faults. */
export function StatusDot({ status, label }: { status: Status; label?: string }) {
  return <span role="img" aria-label={label ?? NAME[status]} className={`inline-block h-3 w-3 flex-shrink-0 rounded-full ${COLOR[status]}`} />
}
