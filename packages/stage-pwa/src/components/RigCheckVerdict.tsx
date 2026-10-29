import { useState } from 'react'
import { getServerTime } from '../lib/clockSync'
import { getDeviceId } from '../lib/deviceId'
import { deviceReportId, verdictRun, writeOwnReport, type RigCheckDeviceReport } from '../lib/rigCheck'
import { useNow } from '../lib/useNow'
import { useShowLogStore } from '../store/useShowLogStore'
import { Button, Dialog, TextArea } from './ui'

/** Runs answered with "Später" on this device - asked again after a reload, not before. */
const later = new Set<string>()

/**
 * After a Rig-Check (#464, docs/24 §3 step 7) every device that took part asks "Alles in Ordnung?" -
 * the band's eye-and-ear verdict, stored in that device's report and shown in the Nachbericht.
 * Asked for a quarter of an hour after the end, also on the master.
 */
export function RigCheckVerdict() {
  const events = useShowLogStore((state) => state.events)
  useNow()
  const [problem, setProblem] = useState(false)
  const [note, setNote] = useState('')
  const [, setTick] = useState(0)
  const run = verdictRun(events, getServerTime())
  if (!run || run.cancelled || later.has(run.showId)) return null
  const id = deviceReportId(run.showId, getDeviceId())
  const own = events.find((e): e is RigCheckDeviceReport => e.id === id && e.type === 'rig-check-device')
  // Only a device that took part - and only once.
  if (!own || own.verdict !== null) return null

  const answer = async (verdict: 'ok' | 'problem') => {
    // The track state as last reported - the verdict only adds the answer.
    await writeOwnReport(run, own.trackReady, { verdict, note })
    setProblem(false)
    setNote('')
  }
  const close = () => {
    later.add(run.showId)
    setTick((n) => n + 1)
  }

  return (
    <Dialog
      title="Rig-Check: alles in Ordnung?"
      onClose={close}
      closeLabel="Später"
      actions={
        problem ? (
          <>
            <Button onClick={() => setProblem(false)}>Zurück</Button>
            <Button variant="primary" onClick={() => void answer('problem')}>
              Problem melden
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setProblem(true)}>Problem …</Button>
            <Button variant="primary" onClick={() => void answer('ok')}>
              Alles in Ordnung
            </Button>
          </>
        )
      }
    >
      {problem ? (
        <TextArea label="Was war falsch?" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Klick und Beeps klangen doppelt, Prompter zu spät" />
      ) : (
        <p className="text-base text-ink">
          Klangen Klick und Beeps wie ein Ton, wechselte der Prompter auf dem Schlag, kam der Sprung überall gleichzeitig, und hat dein Gerät auf seinen Cue reagiert?
        </p>
      )}
    </Dialog>
  )
}
