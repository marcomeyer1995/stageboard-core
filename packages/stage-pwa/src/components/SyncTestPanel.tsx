import { useEffect, useState } from 'react'
import { Button, Select, Switch, InfoHint } from './ui'
import { getDeviceId } from '../lib/deviceId'
import { getSyncTestStatus, startSyncTest, stopSyncTest } from '../lib/syncTest'
import { useAudioOutputLatencyMs } from '../lib/latencyCompensation'
import { listMidiOutputs } from '../lib/webMidiOutput'
import { useTranslation } from 'react-i18next'

const DURATION_S = 60

/** A per-device default channel, so two devices started with defaults rarely collide. */
function defaultChannel(): number {
  let hash = 0
  for (const char of getDeviceId()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % 16
}

/**
 * Sync test (docs/21 §4): marks every full second of server time with a MIDI note and/or the real
 * click, on every device started at once - a laptop logs it against the Stage-Server's clock
 * (scripts/midi-timing-probe/sync-receiver.py).
 */
export function SyncTestPanel() {
  const { t } = useTranslation('system')
  const [outputs, setOutputs] = useState<{ id: string; name: string }[]>([])
  const [outputId, setOutputId] = useState('')
  const [channel, setChannel] = useState(defaultChannel)
  const [click, setClick] = useState(false)
  const [compensate, setCompensate] = useState(false)
  const latencyMs = useAudioOutputLatencyMs()
  const [, rerender] = useState(0)

  useEffect(() => {
    void listMidiOutputs().then((list) => {
      setOutputs(list)
      if (list[0]) setOutputId((current) => current || list[0].id)
    })
    const timer = setInterval(() => rerender((n) => n + 1), 500)
    return () => clearInterval(timer)
  }, [])

  const status = getSyncTestStatus()

  return (
    <section className="flex flex-col gap-3 rounded-container border border-line bg-surface p-4" aria-label={t('st.aria')}>
      <div className="flex items-center gap-1">
        <h3 className="text-base font-bold text-ink">{t('st.title')}</h3>
        <InfoHint
          label={t('st.explainLabel')}
          text={t('st.explain', { s: DURATION_S })}
        />
      </div>
      <Select
        label={t('st.output')}
        value={outputId}
        onChange={(e) => setOutputId(e.target.value)}
        options={[{ value: '', label: t('st.none') }, ...outputs.map((o) => ({ value: o.id, label: o.name }))]}
      />
      <Select
        label={t('st.channel')}
        value={String(channel)}
        onChange={(e) => setChannel(Number(e.target.value))}
        options={Array.from({ length: 16 }, (_, i) => ({ value: String(i), label: String(i + 1) }))}
      />
      <Switch label={t('st.click')} checked={click} onChange={setClick} />
      {click && (
        <Switch
          label={t('st.compensate', { ms: latencyMs })}
          info={t('st.compensateInfo')}
          checked={compensate}
          onChange={setCompensate}
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        {status.running ? (
          <Button onClick={() => { stopSyncTest(); rerender((n) => n + 1) }}>{t('st.stop')}</Button>
        ) : (
          <Button
            variant="primary"
            disabled={!outputId && !click}
            onClick={() => void startSyncTest({ outputId: outputId || null, channel, click, durationS: DURATION_S, clickLatencyMs: click && compensate ? latencyMs : 0 }).then(() => rerender((n) => n + 1))}
          >
            {t('st.start')}
          </Button>
        )}
        <span role="status" className="text-base text-ink">
          {status.running ? t('st.running', { n: status.marked }) : status.marked > 0 ? t('st.done', { n: status.marked }) : ''}
        </span>
      </div>
    </section>
  )
}
