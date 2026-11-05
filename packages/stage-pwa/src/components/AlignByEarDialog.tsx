import { useEffect, useRef, useState } from 'react'
import { AUDIO_OUTPUT, latencyProfileId } from 'shared-types'
import { getDeviceId } from '../lib/deviceId'
import { findLatencyProfile, routeLabel } from '../lib/latencyProfiles'
import { ALIGN_RANGE_MS, ALIGN_SOUND, bracketMiddle, clampAlignValue, laneOffsets, median, pairOffsets } from '../lib/alignByEar'
import { startAlignmentMic, type AlignmentMic } from '../lib/alignmentMic'
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
  const [mic, setMic] = useState<'off' | 'starting' | 'on' | 'failed'>('off')
  const [offsets, setOffsets] = useState<number[]>([])
  const [lanes, setLanes] = useState<{ reference: number[]; target: number[] }>({ reference: [], target: [] })

  const running = session !== null && session.targetDeviceId === targetDeviceId
  const output = running ? session.targetOutput : undefined
  const route = running ? session.targetRoute : undefined
  const profile = output && route ? findLatencyProfile(profiles, targetDeviceId, output, route) : null
  const value = profile?.latencyMs ?? 0
  const nameOf = (id: string) => devices.find((d) => d.id === id)?.name ?? id
  // The value the session started with: it moves at most ALIGN_RANGE_MS from there - less than half
  // a beat, so it can't land on the neighbouring click.
  const startValue = useRef<number | null>(null)
  if (output && route && startValue.current === null) startValue.current = value
  if (!running) startValue.current = null

  // Live microphone (Marco, 2026-11-05): the clicks of both devices as heard here, as dots against
  // the reference - align by eye and ear together. Clicks from before the last change don't count.
  const micRef = useRef<AlignmentMic | null>(null)
  const heard = useRef<{ reference: number[]; target: number[] }>({ reference: [], target: [] })
  const changedAt = useRef(0)
  useEffect(() => {
    if (mic !== 'starting') return
    let cancelled = false
    startAlignmentMic((band, timeS) => {
      const list = heard.current[band]
      list.push(timeS)
      if (list.length > 40) list.shift()
    }).then(
      (m) => {
        if (cancelled) m.stop()
        else {
          micRef.current = m
          setMic('on')
        }
      },
      () => !cancelled && setMic('failed'),
    )
    return () => {
      cancelled = true
    }
  }, [mic])
  useEffect(() => {
    if (mic !== 'on') return
    const timer = setInterval(() => {
      const since = (performance.now() - changedAt.current) / 1000
      const { reference, target } = heard.current
      // The microphone's context runs on its own clock: keep what came after the last change.
      const last = Math.max(reference[reference.length - 1] ?? 0, target[target.length - 1] ?? 0)
      const from = last - Math.min(since, 6)
      const recentRef = reference.filter((x) => x >= from - 0.3)
      const recentTarget = target.filter((x) => x >= from)
      setOffsets(pairOffsets(recentRef, recentTarget).slice(-8))
      setLanes(laneOffsets(recentRef, recentTarget, useAlignmentStore.getState().session?.periodMs ?? 600))
    }, 300)
    return () => clearInterval(timer)
  }, [mic])
  useEffect(() => () => micRef.current?.stop(), [])
  const measured = offsets.length >= 4 ? median(offsets) : null

  // Leaving the dialog ends the session - the clicks must not go on unseen.
  useEffect(() => () => void useAlignmentStore.getState().stop().catch(() => {}), [])

  async function setValue(next: number) {
    if (!output || !route) return
    if (startValue.current !== null) next = clampAlignValue(next, startValue.current)
    // A change reaches the target's output after ~2 s (sync, then its delay): older clicks are stale.
    changedAt.current = performance.now() + 2500
    setOffsets([])
    setLanes({ reference: [], target: [] })
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
                {mic === 'off' || mic === 'failed' ? (
                  <div className="flex flex-col gap-1">
                    <Button onClick={() => setMic('starting')} className="self-start">
                      {t('align.micStart')}
                    </Button>
                    {mic === 'failed' && <p className="text-sm text-ink-muted">{t('align.micFailed')}</p>}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <TwoLanes
                      lanes={lanes}
                      referenceLabel={t('align.laneReference', { device: nameOf(session.referenceDeviceId), hz: ALIGN_SOUND.reference.hz })}
                      targetLabel={t('align.laneTarget', { device: nameOf(targetDeviceId), hz: ALIGN_SOUND.target.hz })}
                    />
                    <p className="text-lg text-ink">
                      {measured === null
                        ? t('align.micListening')
                        : Math.abs(measured) < 1
                          ? t('align.micTogether', { device: nameOf(targetDeviceId) })
                          : measured > 0
                            ? t('align.micLate', { device: nameOf(targetDeviceId), ms: Math.round(measured) })
                            : t('align.micEarly', { device: nameOf(targetDeviceId), ms: Math.round(-measured) })}
                    </p>
                    {measured !== null && Math.abs(measured) >= 1 && (
                      <Button variant="primary" onClick={() => void setValue(value + Math.round(measured))} className="self-start">
                        {t('align.micApply', { ms: clampAlignValue(value + Math.round(measured), startValue.current ?? value) })}
                      </Button>
                    )}
                  </div>
                )}
                <p className="text-sm text-ink-muted">{t('align.range', { ms: ALIGN_RANGE_MS })}</p>
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

/** Both devices' last clicks as heard by the microphone, one lane each on the same time axis
 * (±100 ms around the reference's beat): the reference's dots in the neutral colour around the
 * middle, the target's in the accent colour - move them under the reference's (Marco, 2026-11-05). */
function TwoLanes({ lanes, referenceLabel, targetLabel }: { lanes: { reference: number[]; target: number[] }; referenceLabel: string; targetLabel: string }) {
  const x = (ms: number) => Math.max(-100, Math.min(100, ms))
  const lane = (values: number[], y: number, className: string) =>
    values.map((v, i) => <circle key={i} cx={x(v)} cy={y} r={4} className={className} opacity={0.35 + (0.65 * (i + 1)) / values.length} />)
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-ink-soft">{referenceLabel}</p>
      <svg viewBox="-110 0 220 70" className="h-28 w-full text-ink-soft" role="img" aria-label={`${referenceLabel} / ${targetLabel}`}>
        <line x1={-100} x2={100} y1={18} y2={18} stroke="currentColor" strokeWidth={0.4} />
        <line x1={-100} x2={100} y1={48} y2={48} stroke="currentColor" strokeWidth={0.4} />
        <line x1={0} x2={0} y1={4} y2={58} stroke="currentColor" strokeWidth={1} strokeDasharray="2 2" />
        {[-100, -50, 50, 100].map((ms) => (
          <g key={ms}>
            <line x1={ms} x2={ms} y1={56} y2={60} stroke="currentColor" strokeWidth={0.5} />
            <text x={ms} y={68} fontSize={6} textAnchor="middle" fill="currentColor">
              {ms > 0 ? `+${ms}` : ms} ms
            </text>
          </g>
        ))}
        {lane(lanes.reference, 18, 'fill-ink-soft')}
        {lane(lanes.target, 48, 'fill-accent')}
      </svg>
      <p className="text-sm text-accent">{targetLabel}</p>
    </div>
  )
}
