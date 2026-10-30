import { useMemo, useState } from 'react'
import type { AnnouncementSettings } from 'shared-types'
import { partNames } from '../lib/announcements'
import { playAnnouncementPreview } from '../lib/announcementPreview'
import { previewSpeech, type ClipVoice } from '../lib/speechClips'
import { ANNOUNCEMENTS_PLUGIN, bandAnnouncementSettings, bandSpeechVoice } from '../lib/speechVoices'
import { usePluginsStore } from '../store/usePluginsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { AnnouncementSettings as AnnouncementsOnHere } from './AnnouncementSettings'
import { COUNT_IN_CUE_PRESETS, CuePatternEditor, PART_CUE_PRESETS } from './CuePatternEditor'
import { Button, Dialog, Field, Section, Select, Switch } from './ui'
import { useVisibleSongs } from '../lib/visibleCatalog'
import { useTranslation } from 'react-i18next'

const METERS = ['4/4', '3/4', '2/4', '6/8', '12/8', '5/4', '7/8']

/**
 * section-announcements' settings (#63), for the whole band: two cue patterns - the bars before
 * every part, and the count-in - the number words, what is said for each part name, and "Ablauf
 * anhören" to hear it all with the click before a gig.
 */
export function AnnouncementTextsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('addons')
  const installed = usePluginsStore((state) => state.installed)
  const updateSettings = usePluginsStore((state) => state.updateSettings)
  const songs = useVisibleSongs()
  const variants = useSongVariantsStore((state) => state.variants)
  const settings = bandAnnouncementSettings(installed)
  const voice = bandSpeechVoice(installed)
  const { texts } = settings
  const save = (patch: Partial<AnnouncementSettings>) => void updateSettings(ANNOUNCEMENTS_PLUGIN, patch)
  // A word field for every beat a pattern can number.
  const wordCount = Math.max(4, ...[...settings.partCue, ...settings.countInCue].map((bar) => bar.length))

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
    <Dialog title={t('ann.title')} onClose={onClose} size="l">
      <div className="flex flex-col gap-6">
        {/* Per device, unlike everything below (Marco, 2026-10-16: with the plugin, not in a tab of its own). */}
        <Section title={t('ann.onDevice')}>
          <AnnouncementsOnHere />
        </Section>
        <Section title={t('ann.beforePart')} info={t('ann.beforePartInfo')}>
          <CuePatternEditor label={t('ann.pattern')} pattern={settings.partCue} presets={PART_CUE_PRESETS} onChange={(partCue) => save({ partCue })} />
        </Section>

        <Section
          title={t('ann.countIn')}
          info={t('ann.countInInfo')}
        >
          <CuePatternEditor label={t('ann.pattern')} pattern={settings.countInCue} presets={COUNT_IN_CUE_PRESETS} onChange={(countInCue) => save({ countInCue })} />
        </Section>

        <Section
          title={t('ann.numbers')}
          info={t('ann.numbersInfo')}
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: wordCount }, (_, i) => (
              <NumberWord
                key={i}
                n={i + 1}
                value={settings.numberWords[i] ?? ''}
                onSave={(word) => {
                  const words = [...settings.numberWords]
                  while (words.length <= i) words.push('')
                  words[i] = word.trim()
                  save({ numberWords: words })
                }}
              />
            ))}
          </div>
        </Section>

        <PreviewSection names={names} settings={settings} voice={voice} />

        <Section title={t('ann.texts')} info={t('ann.textsInfo')}>
          {names.length === 0 && (
            <p className="text-base text-ink-faint">
              {t('ann.noParts', { part: '{part: Chorus}', chorus: '{start_of_chorus}' })}
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

function NumberWord({ n, value, onSave }: { n: number; value: string; onSave: (word: string) => void }) {
  const [draft, setDraft] = useState(value)
  return <Field label={String(n)} value={draft} placeholder={String(n)} maxLength={30} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== value && onSave(draft)} />
}

function PreviewSection({ names, settings, voice }: { names: string[]; settings: AnnouncementSettings; voice: ClipVoice }) {
  const { t } = useTranslation('addons')
  const [part, setPart] = useState(names.find((n) => /chorus|refrain/i.test(n)) ?? names[0] ?? 'Chorus')
  const [bpm, setBpm] = useState('120')
  const [meter, setMeter] = useState('4/4')
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const tempo = Number(bpm.replace(',', '.'))
  const valid = Number.isFinite(tempo) && tempo >= 40 && tempo <= 260
  async function play() {
    setState('busy')
    const ok = await playAnnouncementPreview(part, tempo, meter, settings, voice)
    setState(ok ? 'idle' : 'failed')
  }
  return (
    <Section title={t('ann.preview')} info={t('ann.previewInfo')}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Select label={t('ann.part')} value={part} onChange={(e) => setPart(e.target.value)} options={(names.length ? names : ['Chorus']).map((n) => ({ value: n, label: n }))} />
        </div>
        <div className="w-28">
          <Select label={t('ann.meter')} value={meter} onChange={(e) => setMeter(e.target.value)} options={METERS.map((m) => ({ value: m, label: m }))} />
        </div>
        <div className="w-28">
          <Field label={t('ann.tempo')} inputMode="decimal" value={bpm} onChange={(e) => setBpm(e.target.value)} />
        </div>
        <Button variant="primary" disabled={!valid || state === 'busy'} onClick={() => void play()}>
          {state === 'busy' ? t('ann.making') : t('ann.playFlow')}
        </Button>
      </div>
      {state === 'failed' && <p className="text-base text-danger">{t('ann.failed')}</p>}
    </Section>
  )
}

function lookup(texts: Record<string, string | null>, name: string): string | null | undefined {
  const key = Object.keys(texts).find((k) => k.trim().toLowerCase() === name.toLowerCase())
  return key === undefined ? undefined : texts[key]
}

function TextRow({ name, entry, voice, onSave }: { name: string; entry: string | null | undefined; voice: ClipVoice; onSave: (value: string | null) => void }) {
  const { t } = useTranslation('addons')
  const [draft, setDraft] = useState(entry ?? '')
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const announced = entry !== null

  async function listen() {
    setState('busy')
    const ok = await previewSpeech(draft.trim() || name, voice)
    setState(ok ? 'idle' : 'failed')
  }

  return (
    <section className="flex flex-col gap-2 rounded-container border border-line p-3" aria-label={t('ann.rowAria', { name })}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-ink">{name}</h3>
        <Switch layout="inline" label={t('ann.announce')} checked={announced} onChange={(on) => onSave(on ? draft : null)} />
      </div>
      {announced && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field
              label={t('ann.spoken')}
              value={draft}
              placeholder={name}
              maxLength={80}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => draft !== (entry ?? '') && onSave(draft)}
            />
          </div>
          <Button disabled={state === 'busy'} onClick={() => void listen()}>
            {state === 'busy' ? t('ann.making') : t('ann.listen')}
          </Button>
        </div>
      )}
      {state === 'failed' && <p className="text-base text-danger">{t('ann.failed')}</p>}
    </section>
  )
}
