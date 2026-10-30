import i18n from '../i18n'
import { useEffect, useState } from 'react'
import { Button, InfoHint } from './ui'
import { CUE_LOOKAHEAD_MS, CUE_TICK_MS } from '../lib/cueSchedule'
import { getCueTimingStats, resetCueTimingStats, STALL_BUCKETS_MS, TICK_GAP_BUCKETS_MS } from '../lib/cueTimingStats'
import { useTranslation } from 'react-i18next'

/** Bucket labels for a list of upper edges plus the open-ended last one. */
function bucketLabels(edges: readonly number[], from: number): string[] {
  return edges.map((edge, i) => `${i === 0 ? from : edges[i - 1]}-${edge} ms`).concat(i18n.t('system:ct.over', { ms: edges[edges.length - 1] }))
}

/**
 * How punctually this device's cue scheduler worked while songs played (#477, docs/21 §5) -
 * refreshed once a second while open. A pause of the scheduler longer than the look-ahead minus one
 * tick is what makes a cue late, so the longest pause is the number that matters.
 */
export function CueTimingPanel() {
  const { t } = useTranslation('system')
  const [, rerender] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => rerender((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  const stats = getCueTimingStats()
  const critical = CUE_LOOKAHEAD_MS - CUE_TICK_MS
  const TICK_LABELS = bucketLabels(TICK_GAP_BUCKETS_MS, 0)
  const STALL_LABELS = bucketLabels(STALL_BUCKETS_MS, 50)

  return (
    <section className="flex flex-col gap-2 rounded-container border border-line bg-surface p-4" aria-label={t('ct.aria')}>
      <div className="flex items-center gap-1">
        <h3 className="text-base font-bold text-ink">{t('ct.title')}</h3>
        <InfoHint
          label={t('ct.explainLabel')}
          text={t('ct.explain', { critical, lookahead: CUE_LOOKAHEAD_MS, tick: CUE_TICK_MS })}
        />
      </div>
      <p className="text-sm text-ink-muted">{t('ct.since', { time: new Date(stats.since).toLocaleTimeString(i18n.language) })}</p>
      {stats.watchedMs === 0 ? (
        <p className="text-base text-ink-faint">{t('ct.none')}</p>
      ) : (
        <>
          <p className="text-base text-ink">
            {t('ct.stalls', { min: Math.round(stats.watchedMs / 60_000), count: stats.stallBuckets.reduce((sum, n) => sum + n, 0) })}
            <strong className={stats.stallMaxMs > critical ? 'text-danger' : 'text-ink'}>{Math.round(stats.stallMaxMs)} ms</strong>
          </p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 font-sb-mono text-sm text-ink sm:grid-cols-4" aria-label={t('ct.stallList')}>
            {stats.stallBuckets.map((count, i) => (
              <li key={STALL_LABELS[i]}>
                {STALL_LABELS[i]}: {count}
              </li>
            ))}
          </ul>
        </>
      )}
      {stats.ticks > 0 && (
        <>
          <p className="text-base text-ink">
            {t('ct.longestGap')}
            <strong className={stats.tickGapMaxMs > critical ? 'text-danger' : 'text-ink'}>{Math.round(stats.tickGapMaxMs)} ms</strong>
            {t('ct.handed', { count: stats.cuesHandedOver })}
            <strong className={stats.lateHandovers > 0 ? 'text-danger' : 'text-ink'}>{stats.lateHandovers}</strong>
            {stats.lateHandovers > 0 && t('ct.upTo', { ms: Math.round(stats.lateMaxMs) })}
          </p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 font-sb-mono text-sm text-ink sm:grid-cols-4" aria-label={t('ct.gapList')}>
            {stats.tickGapBuckets.map((count, i) => (
              <li key={TICK_LABELS[i]}>
                {TICK_LABELS[i]}: {count}
              </li>
            ))}
          </ul>
        </>
      )}
      <div>
        <Button
          onClick={() => {
            resetCueTimingStats()
            rerender((n) => n + 1)
          }}
        >
          {t('ct.reset')}
        </Button>
      </div>
    </section>
  )
}
