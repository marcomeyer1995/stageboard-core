import { useEffect, useState } from 'react'
import { AUDIO_OUTPUT, latencyProfileId } from 'shared-types'
import { getDeviceId } from '../lib/deviceId'
import { findLatencyProfile, routeLabel } from '../lib/latencyProfiles'
import { bracketMiddle } from '../lib/alignByEar'
import { useAlignmentStore } from '../store/useAlignmentStore'
import { useDevicesStore } from '../store/useDevicesStore'
import { useLatencyProfilesStore } from '../store/useLatencyProfilesStore'
import { Button, Dialog, Select } from './ui'
import { useTranslation } from 'react-i18next'

/**
 * "Abgleich nach Gehör" (docs/21 §4) for one device, from any device: a reference device and the
 * target click together on the band clock, nothing else; whoever stands at the listening position
 * moves the target's value until the two clicks merge - or brackets: the value where the flam is
 * just audible on one side, then on the other, and takes the middle. Writes the target's latency
 * profile (`source: 'manual'`) for the output its scheduler reads, which it reported to the session.
 */
export function AlignByEarDialog({ targetDeviceId, onClose }: { targetDeviceId: string; onClose: () => void }) {
  const { t } = useTranslation('devices')
  const devices = useDevicesStore((state) => state.devices).filter((d) => !d.revoked)
  const session = useAlignmentStore((state) => state.session)
  const start = useAlignmentStore((state) => state.start)
  const stop = useAlignmentStore((state) => state.stop)
  const profiles = useLatencyProfilesStore((state) => state.profiles)
  const save = useLatencyProfilesStore((state) => state.save)
  const others = devices.filter((d) => d.id !== targetDeviceId)
  const [reference, setReference] = useState(() => (getDeviceId() !== targetDeviceId ? getDeviceId() : (others[0]?.id ?? '')))
  const [marks, setMarks] = useState<number[]>([])

  const running = session !== null && session.targetDeviceId === targetDeviceId
  const output = running ? session.targetOutput : undefined
  const route = running ? session.targetRoute : undefined
  const profile = output && route ? findLatencyProfile(profiles, targetDeviceId, output, route) : null
  const value = profile?.latencyMs ?? 0
  const nameOf = (id: string) => devices.find((d) => d.id === id)?.name ?? id

  // Leaving the dialog ends the session - the clicks must not go on unseen.
  useEffect(() => () => void useAlignmentStore.getState().stop().catch(() => {}), [])

  async function setValue(next: number) {
    if (!output || !route) return
    // The WebView's value is its whole latency (never below 0); the native output's is what is heard
    // later than AAudio reports, and may be negative when the reference itself is late.
    const latencyMs = output === AUDIO_OUTPUT ? Math.max(0, Math.round(next)) : Math.round(next)
    await save({ id: latencyProfileId(targetDeviceId, output, route), deviceId: targetDeviceId, output, route, latencyMs, source: 'manual', measuredAt: Date.now() })
  }

  return (
    <Dialog title={t('align.title', { device: nameOf(targetDeviceId) })} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-base text-ink-muted">{t('align.info')}</p>
        {!running ? (
          <>
            <Select label={t('align.reference')} value={reference} onChange={(e) => setReference(e.target.value)} options={others.map((d) => ({ value: d.id, label: d.name }))} />
            <Button variant="primary" disabled={!reference} onClick={() => void start(reference, targetDeviceId)} className="self-start">
              {t('align.start')}
            </Button>
          </>
        ) : (
          <>
            <p className="text-base text-ink">{t('align.running', { reference: nameOf(session.referenceDeviceId) })}</p>
            {!output || !route ? (
              <p className="text-base text-ink-muted">{t('align.waiting')}</p>
            ) : (
              <>
                <p className="text-base text-ink-soft">
                  {t('align.value', { ms: value, route: routeLabel(route) })}
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {[-10, -1, 1, 10].map((step) => (
                    <Button key={step} size="stage" onClick={() => void setValue(value + step)}>
                      {step > 0 ? `+${step}` : `−${-step}`}
                    </Button>
                  ))}
                </div>
                <p className="text-sm text-ink-muted">{t('align.direction')}</p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setMarks((m) => [...m.slice(-1), value])}>{t('align.mark')}</Button>
                  {marks.length === 2 && (
                    <Button variant="primary" onClick={() => void setValue(bracketMiddle(marks[0]!, marks[1]!)).then(() => setMarks([]))}>
                      {t('align.middle', { ms: bracketMiddle(marks[0]!, marks[1]!) })}
                    </Button>
                  )}
                </div>
                {marks.length > 0 && <p className="text-sm text-ink-muted">{t('align.marks', { marks: marks.join(' / ') })}</p>}
              </>
            )}
            <Button onClick={() => void stop()} className="self-start">
              {t('align.stop')}
            </Button>
          </>
        )}
      </div>
    </Dialog>
  )
}
