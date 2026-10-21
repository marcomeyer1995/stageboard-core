import { useEffect, useState } from 'react'
import { Button, InfoHint } from './ui'
import { CUE_LOOKAHEAD_MS, CUE_TICK_MS } from '../lib/cueSchedule'
import { getCueTimingStats, resetCueTimingStats, STALL_BUCKETS_MS, TICK_GAP_BUCKETS_MS } from '../lib/cueTimingStats'

/** Bucket labels for a list of upper edges plus the open-ended last one. */
function bucketLabels(edges: readonly number[], from: number): string[] {
  return edges.map((edge, i) => `${i === 0 ? from : edges[i - 1]}-${edge} ms`).concat(`über ${edges[edges.length - 1]} ms`)
}
const TICK_LABELS = bucketLabels(TICK_GAP_BUCKETS_MS, 0)
const STALL_LABELS = bucketLabels(STALL_BUCKETS_MS, 50)

/**
 * How punctually this device's cue scheduler worked while songs played (#477, docs/21 §5) -
 * refreshed once a second while open. A pause of the scheduler longer than the look-ahead minus one
 * tick is what makes a cue late, so the longest pause is the number that matters.
 */
export function CueTimingPanel() {
  const [, rerender] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => rerender((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  const stats = getCueTimingStats()
  const critical = CUE_LOOKAHEAD_MS - CUE_TICK_MS

  return (
    <section className="flex flex-col gap-2 rounded-container border border-line bg-surface p-4" aria-label="Cue-Timing">
      <div className="flex items-center gap-1">
        <h3 className="text-base font-bold text-ink">Cue-Timing auf diesem Gerät</h3>
        <InfoHint
          label="Erklärung: Cue-Timing"
          text={`Gemessen nur, während ein Song läuft. Ein Cue kommt zu spät, wenn die App länger als ${critical} ms stillsteht (Vorlauf ${CUE_LOOKAHEAD_MS} ms minus ein Takt von ${CUE_TICK_MS} ms). Pausen des Planers gibt es nur bei Songs mit Cues.`}
        />
      </div>
      <p className="text-sm text-ink-muted">Seit {new Date(stats.since).toLocaleTimeString('de-DE')}</p>
      {stats.watchedMs === 0 ? (
        <p className="text-base text-ink-faint">Noch keine Messung - einen Song im Gig-Modus abspielen.</p>
      ) : (
        <>
          <p className="text-base text-ink">
            Stillstände der App (ab 50 ms) während {Math.round(stats.watchedMs / 60_000)} min Wiedergabe: {stats.stallBuckets.reduce((sum, n) => sum + n, 0)} · längster:{' '}
            <strong className={stats.stallMaxMs > critical ? 'text-danger' : 'text-ink'}>{Math.round(stats.stallMaxMs)} ms</strong>
          </p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 font-sb-mono text-sm text-ink sm:grid-cols-4" aria-label="Stillstände">
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
            Längste Pause des Planers: <strong className={stats.tickGapMaxMs > critical ? 'text-danger' : 'text-ink'}>{Math.round(stats.tickGapMaxMs)} ms</strong> ·{' '}
            Cues übergeben: {stats.cuesHandedOver} · davon zu spät: <strong className={stats.lateHandovers > 0 ? 'text-danger' : 'text-ink'}>{stats.lateHandovers}</strong>
            {stats.lateHandovers > 0 && ` (bis ${Math.round(stats.lateMaxMs)} ms)`}
          </p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 font-sb-mono text-sm text-ink sm:grid-cols-4" aria-label="Pausen des Planers">
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
          Zurücksetzen
        </Button>
      </div>
    </section>
  )
}
