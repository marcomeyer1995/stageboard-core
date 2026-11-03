import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getServerTime } from '../lib/clockSync'
import { getDeviceId } from '../lib/deviceId'
import { deviceReportId, verdictRun, writeOwnReport, type RigCheckDeviceReport } from '../lib/rigCheck'
import { useNow } from '../lib/useNow'
import { measuredNote, measuredVerdict } from '../lib/rigCheckMeasure'
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
  const { t } = useTranslation('rigcheck')
  const events = useShowLogStore((state) => state.events)
  useNow()
  // null: not chosen yet - a red measurement (#662) opens at "Problem" with its note filled in.
  const [choice, setChoice] = useState<'question' | 'problem' | null>(null)
  const [typed, setTyped] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const run = verdictRun(events, getServerTime())
  if (!run || run.cancelled || later.has(run.showId)) return null
  const id = deviceReportId(run.showId, getDeviceId())
  const own = events.find((e): e is RigCheckDeviceReport => e.id === id && e.type === 'rig-check-device')
  // Only a device that took part - and only once.
  if (!own || own.verdict !== null) return null
  const measuredRed = measuredVerdict(own.measured) === 'problem'
  const problem = choice === 'problem' || (choice === null && measuredRed)
  const note = typed ?? (measuredRed && own.measured ? measuredNote(own.measured) : '')
  const setProblem = (value: boolean) => setChoice(value ? 'problem' : 'question')
  const setNote = (value: string) => setTyped(value)

  const answer = async (verdict: 'ok' | 'problem') => {
    // The track state as last reported - the verdict only adds the answer.
    await writeOwnReport(run, own.trackReady, { verdict, note: verdict === 'problem' ? note : '' })
    setChoice(null)
    setTyped(null)
  }
  const close = () => {
    later.add(run.showId)
    setTick((n) => n + 1)
  }

  return (
    <Dialog
      title={t('verdict.title')}
      onClose={close}
      closeLabel={t('verdict.later')}
      actions={
        problem ? (
          <>
            <Button onClick={() => setProblem(false)}>{t('verdict.back')}</Button>
            <Button variant="primary" onClick={() => void answer('problem')}>
              {t('verdict.report')}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setProblem(true)}>{t('verdict.problem')}</Button>
            <Button variant="primary" onClick={() => void answer('ok')}>
              {t('verdict.ok')}
            </Button>
          </>
        )
      }
    >
      {problem ? (
        <TextArea label={t('verdict.whatWrong')} rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('verdict.placeholder')} />
      ) : (
        <p className="text-base text-ink">
          {t('verdict.question')}
        </p>
      )}
    </Dialog>
  )
}
