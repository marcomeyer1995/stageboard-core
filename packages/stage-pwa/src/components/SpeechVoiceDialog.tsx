import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_SPEECH_VOICE, type SpeechVoice, type SpeechVoiceLicense, type SpeechVoicesResponse } from 'shared-types'
import { previewSpeech } from '../lib/speechClips'
import { bandSpeechVoice, fetchSpeechVoices, fetchVoiceLicense, installSpeechVoice, PIPER_SPEECH_PLUGIN, previewText } from '../lib/speechVoices'
import { usePluginsStore } from '../store/usePluginsStore'
import { Badge, Button, Dialog, Field, ListRow, Select } from './ui'

const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`

/**
 * piper-speech's settings (#63): the band's voice - language, then voice, its licence, download to
 * the Stage-Server, and "Probehören" on this device before choosing. Every device then announces
 * with it.
 */
export function SpeechVoiceDialog({ onClose }: { onClose: () => void }) {
  const installed = usePluginsStore((state) => state.installed)
  const updateSettings = usePluginsStore((state) => state.updateSettings)
  const bandVoice = bandSpeechVoice(installed) ?? DEFAULT_SPEECH_VOICE
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
    <Dialog title="Sprachausgabe - Stimme" onClose={onClose} size="l">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">
          Mit dieser Stimme sagen alle Geräte die Songteile an. Eine Stimme wird einmal auf den Stage-Server geladen (Internet nötig, am besten zu Hause), danach geht alles
          offline.
        </p>
        {error && <p className="text-base text-danger">{error}</p>}
        {data && !data.piperInstalled && <p className="text-base text-danger">Piper ist auf dem Stage-Server nicht installiert (docs/21 §9.1).</p>}
        {data?.catalog === 'none' && <p className="text-base text-ink">Stimmenliste nicht erreichbar - Stage-Server offline. Gezeigt werden nur die schon geladenen Stimmen.</p>}
        {!data && !error && <p className="text-base text-ink-muted">Lade Stimmen…</p>}
        {data && (
          <>
            <Select
              label="Sprache"
              value={currentLanguage}
              onChange={(e) => setLanguage(e.target.value)}
              options={languages.map(([code, name]) => ({ value: code, label: `${name} · ${code}` }))}
            />
            <div className="flex flex-col gap-1" role="listbox" aria-label="Stimmen">
              {shown.map((v) => (
                <ListRow
                  key={v.key}
                  title={v.name}
                  subtitle={`${v.languageName} · Qualität ${v.quality || '?'} · ${mb(v.sizeBytes)}`}
                  selected={v.key === selected}
                  onClick={() => setSelected(v.key)}
                  trailing={
                    <span className="flex gap-1">
                      {v.key === bandVoice && <Badge tone="accent">Band</Badge>}
                      {v.installed && <Badge>geladen</Badge>}
                    </span>
                  }
                />
              ))}
            </div>
            {voice && (
              <VoiceDetail
                key={voice.key}
                voice={voice}
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
  data,
  isBandVoice,
  onChoose,
  onStarted,
}: {
  voice: SpeechVoice
  data: SpeechVoicesResponse
  isBandVoice: boolean
  onChoose: () => void
  onStarted: () => void
}) {
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
    const ok = await previewSpeech(text, voice.key)
    setBusy(false)
    if (!ok) setMessage('Konnte nicht abgespielt werden - ist die Stimme geladen und der Stage-Server erreichbar?')
  }

  return (
    <section className="flex flex-col gap-3 rounded-container border border-line p-3" aria-label="Gewählte Stimme">
      <h3 className="text-base font-bold text-ink">
        {voice.name} <span className="font-normal text-ink-muted">({voice.languageName})</span>
      </h3>
      <p className="text-sm text-ink-muted">
        Lizenz: {license ? (license.license ?? 'unbekannt') : '…'}
        {license?.finetunedFrom ? ` · weitertrainiert aus ${license.finetunedFrom} (dessen Lizenz gilt evtl. mit)` : ''}
      </p>
      {!voice.installed && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={download?.state === 'running' || otherRunning || !data.piperInstalled} onClick={() => void startDownload()}>
            Auf den Stage-Server laden ({mb(voice.sizeBytes)})
          </Button>
          {download?.state === 'running' && (
            <span role="status" className="text-base text-ink">
              {download.totalBytes > 0 ? Math.floor((download.receivedBytes / download.totalBytes) * 100) : 0} %
            </span>
          )}
          {download?.state === 'failed' && <span className="text-base text-danger">Fehlgeschlagen: {download.error}</span>}
          {otherRunning && <span className="text-sm text-ink-muted">Erst lädt noch eine andere Stimme.</span>}
        </div>
      )}
      {voice.installed && (
        <>
          <Field label="Text zum Probehören" value={text} onChange={(e) => setText(e.target.value)} maxLength={80} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || text.trim() === ''} onClick={() => void listen()}>
              {busy ? 'Erzeuge…' : '▶ Probehören'}
            </Button>
            <Button variant="primary" disabled={isBandVoice} onClick={onChoose}>
              {isBandVoice ? 'Stimme der Band' : 'Für die Band verwenden'}
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
