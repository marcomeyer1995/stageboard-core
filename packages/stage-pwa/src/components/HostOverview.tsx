import { useTranslation } from 'react-i18next'
import { useHostOverview } from '../lib/useHostOverview'
import { Badge, StatusDot } from './ui'

/**
 * Who is the band's host right now (host backup, #941, docs/25 §6e item 5), in the stage map's "Prüfen":
 * the primary and the backup with what each is doing and which one this device is on, and in words
 * what is wrong. The status bar stays as it is - it shows the song - and says only that a device is on
 * the backup. Nothing is shown without two listed hosts.
 */
export function HostOverview({ active = true }: { active?: boolean }) {
  const { t } = useTranslation('hardware')
  const overview = useHostOverview(active)
  if (!overview || overview.rows.length === 0) return null

  return (
    <section aria-label={t('hostOverview.title')} className="flex flex-col gap-2 rounded-container border border-line p-3">
      <h3 className="text-lg font-bold">{t('hostOverview.title')}</h3>
      {overview.problem && (
        <p role="status" className="text-base font-semibold text-danger">
          {t(`hostOverview.problem.${overview.problem}`)}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {overview.rows.map((row) => (
          <li key={row.hostId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base">
            <StatusDot status={row.status} />
            <span className="font-semibold">{row.hostId}</span>
            <Badge tone={row.role === 'primary' ? 'accent' : 'neutral'}>{t(`hostOverview.role.${row.role}`)}</Badge>
            <span className={row.state === 'host' ? 'font-semibold' : 'text-ink-muted'}>{t(`hostOverview.state.${row.state}`)}</span>
            {row.epoch !== null && <span className="text-ink-muted">{t('hostOverview.epoch', { n: row.epoch })}</span>}
            {row.current && <Badge tone="neutral">{t('hostOverview.current')}</Badge>}
          </li>
        ))}
      </ul>
    </section>
  )
}
