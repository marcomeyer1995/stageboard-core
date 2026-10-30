import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_SPEECH_VOICE, SPEECH_SPEED_MAX, SPEECH_SPEED_MIN, type SpeechVoice, type SpeechVoiceLicense, type SpeechVoicesResponse } from 'shared-types'
import { previewSpeech } from '../lib/speechClips'
import { bandSpeechVoice, fetchSpeechVoices, fetchVoiceLicense, installSpeechVoice, PIPER_SPEECH_PLUGIN, previewText } from '../lib/speechVoices'
import { usePluginsStore } from '../store/usePluginsStore'
import { Badge, Button, Dialog, Field, ListRow, Select, Slider } from './ui'
import { useTranslation } from 'react-i18next'

const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`

/**
 * piper-speech's settings (#63): the band's voice - language, then voice, its licence, download to
 * the Stage-Server, and "Probehören" on this device before choosing. Every device then announces
 * with it.
 */
export function SpeechVoiceDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('addons')
  const installed = usePluginsStore((state) => state.installed)
  const updateSettings = usePluginsStore((state) => state.updateSettings)
  const band = bandSpeechVoice(installed)
  const bandVoice = band.voice ?? DEFAULT_SPEECH_VOICE
  // The pace slider writes once it rests, not on every step.
  const [speed, setSpeed] = useState(band.speed ?? 1)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function changeSpeed(value: number) {
    setSpeed(value)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void updateSettings(PIPER_SPEECH_PLUGIN, { speed: value }), 500)
  }
  const [data, setData] = useState<SpeechVoicesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [language, setLanguage] = useState<string | null>(null)
  const [selected, setSelected] = useState<string>(bandVoice)

  const downloading = data?.download?.state === 'running'
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const result = await fetchSpeechVoices()
      if (cancelled) return
      if (result.ok) {
        setData(result.data)
        setError(null)
      } else setError(result.message)
    }
    void load()
    // While a voice downloads: progress every second.
    const timer = downloading ? setInterval(() => void load(), 1000) : null
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [downloading])

  const voices = useMemo(() => data?.voices ?? [], [data])
  const languages = useMemo(() => {
    const seen = new Map<string, string>()
    for (const v of voices) if (!seen.has(v.languageCode) || v.origin === 'piper') seen.set(v.languageCode, v.languageName.replace(/ – .*/, ''))
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]))
  }, [voices])
  const currentLanguage = language ?? voices.find((v) => v.key === selected)?.languageCode ?? 'de_DE'
  const shown = voices.filter((v) => v.languageCode === currentLanguage)
  const voice = voices.find((v) => v.key === selected) ?? null

  return (
    <Dialog title={t('voice.title')} onClose={onClose} size="l">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">
          {t('voice.intro')}
        </p>
        {error && <p className="text-base text-danger">{error}</p>}
        {data && !data.piperInstalled && <p className="text-base text-danger">{t('voice.noPiper')}</p>}
        {data?.catalog === 'none' && <p className="text-base text-ink">{t('voice.noCatalog')}</p>}
        {!data && !error && <p className="text-base text-ink-muted">{t('voice.loading')}</p>}
        {data && (
          <>
            <Slider
              label={t('voice.speed')}
              valueLabel={`${speed.toFixed(1).replace('.', ',')}×`}
              min={SPEECH_SPEED_MIN}
              max={SPEECH_SPEED_MAX}
              step={0.1}
              value={speed}
              onChange={changeSpeed}
            />
            <Select
              label={t('voice.language')}
              value={currentLanguage}
              onChange={(e) => setLanguage(e.target.value)}
              options={languages.map(([code, name]) => ({ value: code, label: `${name} · ${code}` }))}
            />
            <div className="flex flex-col gap-1" role="listbox" aria-label={t('voice.list')}>
              {shown.map((v) => (
                <ListRow
                  key={v.key}
                  title={v.name}
                  subtitle={t('voice.subtitle', { language: v.languageName, quality: v.quality || '?', size: mb(v.sizeBytes) })}
                  selected={v.key === selected}
                  onClick={() => setSelected(v.key)}
                  trailing={
                    <span className="flex gap-1">
                      {v.key === bandVoice && <Badge tone="accent">{t('voice.band')}</Badge>}
                      {v.installed && <Badge>{t('voice.loaded')}</Badge>}
                    </span>
                  }
                />
              ))}
            </div>
            {voice && (
              <VoiceDetail
                key={voice.key}
                voice={voice}
                speed={speed}
                data={data}
                isBandVoice={voice.key === bandVoice}
                onChoose={() => void updateSettings(PIPER_SPEECH_PLUGIN, { voice: voice.key })}
                onStarted={() => void fetchSpeechVoices().then((r) => r.ok && setData(r.data))}
              />
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}

function VoiceDetail({
  voice,
  speed,
  data,
  isBandVoice,
  onChoose,
  onStarted,
}: {
  voice: SpeechVoice
  speed: number
  data: SpeechVoicesResponse
  isBandVoice: boolean
  onChoose: () => void
  onStarted: () => void
}) {
  const { t } = useTranslation('addons')
  const [license, setLicense] = useState<SpeechVoiceLicense | null>(null)
  const [text, setText] = useState(previewText(voice.languageCode))
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void fetchVoiceLicense(voice.key).then((r) => r.ok && setLicense(r.data))
  }, [voice.key])

  const download = data.download?.key === voice.key ? data.download : null
  const otherRunning = data.download?.state === 'running' && data.download.key !== voice.key

  async function startDownload() {
    setMessage(null)
    const result = await installSpeechVoice(voice.key)
    if (!result.ok) setMessage(result.message)
    onStarted()
  }

  async function listen() {
    setBusy(true)
    setMessage(null)
    const ok = await previewSpeech(text, { voice: voice.key, speed })
    setBusy(false)
    if (!ok) setMessage(t('voice.cantPlay'))
  }

  return (
    <section className="flex flex-col gap-3 rounded-container border border-line p-3" aria-label={t('voice.chosen')}>
      <h3 className="text-base font-bold text-ink">
        {voice.name} <span className="font-normal text-ink-muted">({voice.languageName})</span>
      </h3>
      <p className="text-sm text-ink-muted">
        {t('voice.license', { license: license ? (license.license ?? t('voice.unknown')) : '…' })}
        {license?.finetunedFrom ? t('voice.finetuned', { base: license.finetunedFrom }) : ''}
      </p>
      {!voice.installed && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={download?.state === 'running' || otherRunning || !data.piperInstalled} onClick={() => void startDownload()}>
            {t('voice.download', { size: mb(voice.sizeBytes) })}
          </Button>
          {download?.state === 'running' && (
            <span role="status" className="text-base text-ink">
              {download.totalBytes > 0 ? Math.floor((download.receivedBytes / download.totalBytes) * 100) : 0} %
            </span>
          )}
          {download?.state === 'failed' && <span className="text-base text-danger">{t('voice.failed', { error: download.error })}</span>}
          {otherRunning && <span className="text-sm text-ink-muted">{t('voice.otherLoading')}</span>}
        </div>
      )}
      {voice.installed && (
        <>
          <Field label={t('voice.sample')} value={text} onChange={(e) => setText(e.target.value)} maxLength={80} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || text.trim() === ''} onClick={() => void listen()}>
              {busy ? t('voice.making') : t('voice.listen')}
            </Button>
            <Button variant="primary" disabled={isBandVoice} onClick={onChoose}>
              {isBandVoice ? t('voice.isBand') : t('voice.useBand')}
            </Button>
          </div>
        </>
      )}
      {message && (
        <p role="status" className="text-base text-ink">
          {message}
        </p>
      )}
    </section>
  )
}
