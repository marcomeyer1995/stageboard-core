import { useTranslation } from 'react-i18next'
import type { StageLink } from 'shared-types'
import { PATH_MARK, type LiveNote, type LiveStatus, type StageLive } from '../lib/stageLive'
import type { StagePathState } from '../lib/stagePaths'
import { StatusDot } from './ui'

const RANK: Record<LiveStatus, number> = { error: 0, warning: 1, ok: 2, off: 3 }
const TONE: Record<LiveStatus, string> = { error: 'text-danger', warning: 'text-warn', ok: '', off: 'text-ink-muted' }

/**
 * "Prüfen" under the stage map (#747, docs/31 §9): what every device and every cable of the setup
 * reports right now, faults first. The diagnostics in depth stay in "Tablets & Handys".
 */
export function StageLiveList({ live, links, nameOf, linkName }: { live: StageLive | null; links: readonly StageLink[]; nameOf: (equipmentId: string) => string; linkName: (link: StageLink) => string }) {
  const { t } = useTranslation(['hardware', 'devices'])
  if (!live) return <p className="text-base text-ink-muted">{t('live.loading')}</p>

  const noteText = (n: LiveNote): string => (n.key === 'vitals' ? t(`devices:vitals.issue.${n.issue!}`) : t(`live.${n.key}`, { name: n.name ?? '', pct: n.pct ?? 0 }))
  const rows = [
    ...Object.entries(live.equipment).map(([id, state]) => ({ key: `e:${id}`, name: nameOf(id), status: state.status, notes: state.notes, path: null as StagePathState | null })),
    ...links.flatMap((l) => {
      const state = live.links[l.id]
      return state && (state.notes.length > 0 || state.path) ? [{ key: `l:${l.id}`, name: linkName(l), status: state.status, notes: state.notes, path: state.path }] : []
    }),
  ]
    .filter((r) => r.notes.length > 0 || r.path)
    .sort((a, b) => RANK[a.status] - RANK[b.status])
  const faults = rows.filter((r) => r.status === 'error').length
  const warnings = rows.filter((r) => r.status === 'warning').length

  return (
    <div className="flex flex-col gap-2 rounded-container border border-line p-3" aria-live="polite">
      <p className={`text-lg font-bold ${faults > 0 ? 'text-danger' : ''}`}>{faults > 0 ? t('live.faults', { n: faults }) : warnings > 0 ? t('live.warnings', { n: warnings }) : t('live.allGood')}</p>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.key} className="flex items-start gap-2 text-base">
            <span className="mt-1.5">
              <StatusDot status={row.status} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{row.name}</span>
              {row.notes.map((n, i) => (
                <span key={i} className={TONE[n.status]}>
                  {' · '}
                  {noteText(n)}
                </span>
              ))}
              {row.path && <span className="text-ink-muted">{` · ${PATH_MARK[row.path]} ${t(`live.path.${row.path}`)}`}</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-base text-ink-muted">{t('live.legend')}</p>
    </div>
  )
}
