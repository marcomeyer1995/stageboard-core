import { useMemo, useState } from 'react'
import { partNames } from '../lib/announcements'
import { previewSpeech } from '../lib/speechClips'
import { ANNOUNCEMENTS_PLUGIN, bandAnnouncementTexts, bandSpeechVoice } from '../lib/speechVoices'
import { usePluginsStore } from '../store/usePluginsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { useSongsStore } from '../store/useSongsStore'
import { Button, Dialog, Field, Switch } from './ui'

/**
 * section-announcements' settings (#63): what is said for each part name, for the whole band -
 * "Chorus" → "Refrää" for a dialect, or a part never announced. Lists every part name the band's
 * songs use; each with "▶" to hear it in the band's voice on this device.
 */
export function AnnouncementTextsDialog({ onClose }: { onClose: () => void }) {
  const installed = usePluginsStore((state) => state.installed)
  const updateSettings = usePluginsStore((state) => state.updateSettings)
  const songs = useSongsStore((state) => state.songs)
  const variants = useSongVariantsStore((state) => state.variants)
  const texts = bandAnnouncementTexts(installed)
  const voice = bandSpeechVoice(installed)

  const names = useMemo(() => {
    const used = partNames([...songs.map((s) => s.chordProContent), ...variants.map((v) => v.chordProContent)])
    const extra = Object.keys(texts).filter((name) => !used.some((u) => u.toLowerCase() === name.trim().toLowerCase()))
    return [...used, ...extra]
  }, [songs, variants, texts])

  function save(name: string, value: string | null) {
    const next = { ...texts }
    const key = Object.keys(next).find((k) => k.trim().toLowerCase() === name.toLowerCase()) ?? name
    if (value !== null && value.trim() === '') delete next[key]
    else next[key] = value === null ? null : value.trim()
    void updateSettings(ANNOUNCEMENTS_PLUGIN, { texts: next })
  }

  return (
    <Dialog title="Ansagen - Texte" onClose={onClose} size="l">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">
          Was für einen Songteil gesagt wird, für alle Songs der Band. Leer = der Name, wie er im Song steht. Für Dialekt so schreiben, wie es klingen soll („Refrää“).
        </p>
        {names.length === 0 && (
          <p className="text-base text-ink-faint">
            Die Songs haben noch keine Teile ({'{part: Chorus}'}, {'{start_of_chorus}'}).
          </p>
        )}
        {names.map((name) => (
          <TextRow key={name} name={name} entry={lookup(texts, name)} voice={voice} onSave={(value) => save(name, value)} />
        ))}
      </div>
    </Dialog>
  )
}

function lookup(texts: Record<string, string | null>, name: string): string | null | undefined {
  const key = Object.keys(texts).find((k) => k.trim().toLowerCase() === name.toLowerCase())
  return key === undefined ? undefined : texts[key]
}

function TextRow({ name, entry, voice, onSave }: { name: string; entry: string | null | undefined; voice: string | undefined; onSave: (value: string | null) => void }) {
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
