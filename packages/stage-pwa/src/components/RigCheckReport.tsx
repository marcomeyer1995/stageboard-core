import type { ShowLogEvent } from 'shared-types'
import { rigCheckLabel, runReports, type RigCheckRun } from '../lib/rigCheck'
import { RigCheckDeviceRow } from './RigCheckView'

/**
 * A Rig-Check's result at the top of its show in the Nachbericht (#464, docs/24 §3 step 8): every
 * device's state and verdict. The cues it sent and the song stand below as in any show.
 */
export function RigCheckReport({ events }: { events: readonly ShowLogEvent[] }) {
  const run = events.find((event): event is RigCheckRun => event.type === 'rig-check-run')
  if (!run) return null
  const reports = runReports(events, run.showId)
  const ok = reports.filter((r) => r.verdict === 'ok').length
  const problems = reports.filter((r) => r.verdict === 'problem').length
  return (
    <section aria-label="Rig-Check" className="mb-4 flex flex-col gap-2">
      <h3 className="text-lg font-bold text-ink">{rigCheckLabel(events)}</h3>
      <p className="text-sm text-ink-soft">
        {reports.length} {reports.length === 1 ? 'Gerät' : 'Geräte'} · {ok} OK{problems > 0 ? ` · ${problems} mit Problem` : ''} · Test-Song Version {run.version}
      </p>
      {reports.length > 0 && (
        <ul className="flex flex-col">
          {reports.map((report) => (
            <RigCheckDeviceRow key={report.id} report={report} showVerdict />
          ))}
        </ul>
      )}
    </section>
  )
}
