import { useMemo, useState } from 'react'
import type { AnnouncementSettings } from 'shared-types'
import { partNames } from '../lib/announcements'
import { playAnnouncementPreview } from '../lib/announcementPreview'
import { previewSpeech, type ClipVoice } from '../lib/speechClips'
import { ANNOUNCEMENTS_PLUGIN, bandAnnouncementSettings, bandSpeechVoice } from '../lib/speechVoices'
import { usePluginsStore } from '../store/usePluginsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { useSongsStore } from '../store/useSongsStore'
import { Button, Dialog, Field, Section, Segmented, Select, Switch } from './ui'

const COUNT_IN_OPTIONS = [
  { value: 'announce' as const, label: 'Wie die Teile' },
  { value: 'count' as const, label: 'Gesprochen zählen' },
  { value: 'click' as const, label: 'Nur Klick' },
]
const COUNT_IN_HINT: Record<AnnouncementSettings['countIn'], string> = {
  announce: 'Der Teil auf Takt 1 (Intro) wird wie jeder andere angesagt, in den Einzähltakten. Was vor dem ersten Klick läge, entfällt.',
  count: 'Die Einzählschläge werden gesprochen („1, 2, 3, 4“, mit den Zahlwörtern unten); der Teil auf Takt 1 wird nicht angesagt.',
  click: 'Während des Einzählens wird nichts gesagt.',
}

/**
 * section-announcements' settings (#63), for the whole band: when a part's name is said, a
 * countdown before it ("Chorus … 3, 2, 1, Los"), what happens in the count-in, what is said for
 * each part name - and "Ablauf anhören" to hear it all with the click before a gig.
 */
export function AnnouncementTextsDialog({ onClose }: { onClose: () => void }) {
  const installed = usePluginsStore((state) => state.installed)
  const updateSettings = usePluginsStore((state) => state.updateSettings)
  const songs = useSongsStore((state) => state.songs)
  const variants = useSongVariantsStore((state) => state.variants)
  const settings = bandAnnouncementSettings(installed)
  const voice = bandSpeechVoice(installed)
  const { texts, countdown } = settings
  const save = (patch: Partial<AnnouncementSettings>) => void updateSettings(ANNOUNCEMENTS_PLUGIN, patch)

  const names = useMemo(() => {
    const used = partNames([...songs.map((s) => s.chordProContent), ...variants.map((v) => v.chordProContent)])
    const extra = Object.keys(texts).filter((name) => !used.some((u) => u.toLowerCase() === name.trim().toLowerCase()))
    return [...used, ...extra]
  }, [songs, variants, texts])

  function saveText(name: string, value: string | null) {
    const next = { ...texts }
    const key = Object.keys(next).find((k) => k.trim().toLowerCase() === name.toLowerCase()) ?? name
    if (value !== null && value.trim() === '') delete next[key]
    else next[key] = value === null ? null : value.trim()
    save({ texts: next })
  }

  return (
    <Dialog title="Ansagen - Einstellungen" onClose={onClose} size="l">
      <div className="flex flex-col gap-6">
        <Section title="Ablauf">
          <Select
            label="Name ansagen"
            value={String(settings.nameBarsBefore)}
            onChange={(e) => save({ nameBarsBefore: Number(e.target.value) })}
            options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: n === 1 ? '1 Takt vorher' : `${n} Takte vorher` }))}
          />
          <Switch
            label="Countdown"
            description="Die letzten Schläge vor dem Teil werden heruntergezählt: „Chorus … 3, 2, 1“."
            checked={countdown.enabled}
            onChange={(on) => save({ countdown: { ...countdown, enabled: on } })}
          />
          {countdown.enabled && (
            <>
              <Select
                label="Zählen ab"
                value={String(countdown.beats)}
                onChange={(e) => save({ countdown: { ...countdown, beats: Number(e.target.value) } })}
                options={[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: String(n), label: Array.from({ length: n }, (_, i) => n - i).join(', ') }))}
              />
              <GoWord countdown={countdown} onSave={(go) => save({ countdown: { ...countdown, go } })} />
            </>
          )}
        </Section>

        <Section title="Einzählen" hint={COUNT_IN_HINT[settings.countIn]}>
          <Segmented label="Einzählen" options={COUNT_IN_OPTIONS} value={settings.countIn} onChange={(countIn) => save({ countIn })} />
        </Section>

        {(countdown.enabled || settings.countIn === 'count') && (
          <Section title="Zahlwörter" hint="Leer = die Ziffer, die jede Stimme in ihrer Sprache liest. Für Dialekt so schreiben, wie es klingen soll („zwaa“).">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Array.from({ length: Math.max(countdown.enabled ? countdown.beats : 0, settings.countIn === 'count' ? 4 : 0) }, (_, i) => (
                <NumberWord
                  key={i}
                  n={i + 1}
                  value={countdown.words[i] ?? ''}
                  onSave={(word) => {
                    const words = [...countdown.words]
                    while (words.length <= i) words.push('')
                    words[i] = word.trim()
                    save({ countdown: { ...countdown, words } })
                  }}
                />
              ))}
            </div>
          </Section>
        )}

        <PreviewSection names={names} settings={settings} voice={voice} />

        <Section title="Texte je Teil" hint="Was für einen Songteil gesagt wird, für alle Songs der Band. Leer = der Name, wie er im Song steht.">
          {names.length === 0 && (
            <p className="text-base text-ink-faint">
              Die Songs haben noch keine Teile ({'{part: Chorus}'}, {'{start_of_chorus}'}).
            </p>
          )}
          {names.map((name) => (
            <TextRow key={name} name={name} entry={lookup(texts, name)} voice={voice} onSave={(value) => saveText(name, value)} />
          ))}
        </Section>
      </div>
    </Dialog>
  )
}

function GoWord({ countdown, onSave }: { countdown: AnnouncementSettings['countdown']; onSave: (go: string | null) => void }) {
  const [draft, setDraft] = useState(countdown.go ?? 'Los')
  return (
    <>
      <Switch
        label="Wort auf dem ersten Schlag"
        description="Fällt genau auf den Einsatz des Teils - dort beginnt auch die Musik."
        checked={countdown.go !== null}
        onChange={(on) => onSave(on ? draft.trim() || 'Los' : null)}
      />
      {countdown.go !== null && (
        <Field label="Wort" value={draft} maxLength={30} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft.trim() && draft !== countdown.go && onSave(draft.trim())} />
      )}
    </>
  )
}

function NumberWord({ n, value, onSave }: { n: number; value: string; onSave: (word: string) => void }) {
  const [draft, setDraft] = useState(value)
  return <Field label={String(n)} value={draft} placeholder={String(n)} maxLength={30} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== value && onSave(draft)} />
}

function PreviewSection({ names, settings, voice }: { names: string[]; settings: AnnouncementSettings; voice: ClipVoice }) {
  const [part, setPart] = useState(names.find((n) => /chorus|refrain/i.test(n)) ?? names[0] ?? 'Chorus')
  const [bpm, setBpm] = useState('120')
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const tempo = Number(bpm.replace(',', '.'))
  const valid = Number.isFinite(tempo) && tempo >= 40 && tempo <= 260
  async function play() {
    setState('busy')
    const ok = await playAnnouncementPreview(part, tempo, settings, voice)
    setState(ok ? 'idle' : 'failed')
  }
  return (
    <Section title="Probehören" hint="Spielt auf diesem Gerät mit Klick: einen Takt Einzählen, das Intro und den gewählten Teil auf Takt 4.">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Select label="Teil" value={part} onChange={(e) => setPart(e.target.value)} options={(names.length ? names : ['Chorus']).map((n) => ({ value: n, label: n }))} />
        </div>
        <div className="w-28">
          <Field label="Tempo (BPM)" inputMode="decimal" value={bpm} onChange={(e) => setBpm(e.target.value)} />
        </div>
        <Button variant="primary" disabled={!valid || state === 'busy'} onClick={() => void play()}>
          {state === 'busy' ? 'Erzeuge…' : '▶ Ablauf anhören'}
        </Button>
      </div>
      {state === 'failed' && <p className="text-base text-danger">Konnte nicht abgespielt werden - Stage-Server und Sprachausgabe-Plugin prüfen.</p>}
    </Section>
  )
}

function lookup(texts: Record<string, string | null>, name: string): string | null | undefined {
  const key = Object.keys(texts).find((k) => k.trim().toLowerCase() === name.toLowerCase())
  return key === undefined ? undefined : texts[key]
}

function TextRow({ name, entry, voice, onSave }: { name: string; entry: string | null | undefined; voice: ClipVoice; onSave: (value: string | null) => void }) {
  const [draft, setDraft] = useState(entry ?? '')
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const announced = entry !== null

  async function listen() {
    setState('busy')
    const ok = await previewSpeech(draft.trim() || name, voice)
    setState(ok ? 'idle' : 'failed')
  }

  return (
    <section className="flex flex-col gap-2 rounded-container border border-line p-3" aria-label={`Ansage ${name}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-ink">{name}</h3>
        <Switch layout="inline" label="Ansagen" checked={announced} onChange={(on) => onSave(on ? draft : null)} />
      </div>
      {announced && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field
              label="Gesprochen"
              value={draft}
              placeholder={name}
              maxLength={80}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => draft !== (entry ?? '') && onSave(draft)}
            />
          </div>
          <Button disabled={state === 'busy'} onClick={() => void listen()}>
            {state === 'busy' ? 'Erzeuge…' : '▶ Anhören'}
          </Button>
        </div>
      )}
      {state === 'failed' && <p className="text-base text-danger">Konnte nicht abgespielt werden - Stage-Server und Sprachausgabe-Plugin prüfen.</p>}
    </section>
  )
}
