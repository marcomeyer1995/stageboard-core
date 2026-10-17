import { useShowPart } from '../lib/widgetParts'
import { Segmented, Switch, ToggleChip } from '../components/ui'
import { resolveTrackForEntry } from '../lib/computeQueue'
import { useShowMode } from '../lib/showMode'
import { stageFontSize } from '../lib/stageSize'
import { channelOf, STEM_MAX_LEVEL, stemMixFor, useStemMixStore } from '../lib/stemMix'
import { pickStemSet, STEM_ROLE_LABELS, stemSetsOf } from '../lib/stems'
import { useStemPlaybackStore, type StemPlaybackStatus } from '../store/useStemPlaybackStore'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type StemsConfig } from './stemsConfig'
import { SizeRatioSlider } from './SizeRatioSlider'

const percent = (level: number) => Math.round(level * 100)

const STATUS_TEXT: Record<StemPlaybackStatus, string | null> = {
  off: null,
  loading: 'Spuren werden geladen - bis dahin spielt der Track.',
  ready: null,
  error: 'Spuren konnten nicht geladen werden - es spielt der Track.',
}

/**
 * "Stems" (docs/22 §3): the current song's stems instead of its track, each with a level, Stumm
 * and Solo - e.g. the guitar muted to play it yourself. Remembered per song on this device. Plays
 * in Solo practice (useStemPlaybackDriver.ts); in Gig mode the settings can be prepared, but the
 * track plays.
 */
export function StemsWidget({ config }: { config: StemsConfig }) {
  // Parts left out under "Anzeigen" in the ⋯ menu (Marco, 2026-10-17: declutter every widget).
  const showValues = useShowPart('values')
  const { mode, queue, trackOverride } = useShowMode()
  const { currentEntry, currentVariant } = queue
  const byVariant = useStemMixStore((state) => state.byVariant)
  const setOn = useStemMixStore((state) => state.setOn)
  const setSet = useStemMixStore((state) => state.setSet)
  const setChannel = useStemMixStore((state) => state.setChannel)
  const status = useStemPlaybackStore((state) => state.status)
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = stageFontSize(baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO))

  const sets = currentVariant ? stemSetsOf(currentVariant.tracks) : []
  const settings = stemMixFor(currentVariant?.id, byVariant)
  const playingTrack = resolveTrackForEntry(currentEntry, currentVariant, trackOverride)
  const set = pickStemSet(sets, settings.set, playingTrack?.id ?? null)

  if (!currentVariant || !set) {
    return (
      <div className="flex h-full w-full items-center justify-center text-center text-ink-faint" style={{ fontSize }}>
        {currentVariant ? 'Dieser Song hat keine Spuren. Im Song-Editor unter Audio: „Spuren trennen“ oder Stems hochladen.' : 'Kein Song gewählt.'}
      </div>
    )
  }
  const variantId = currentVariant.id
  const anySolo = set.stems.some((stem) => channelOf(settings, stem.id).solo)
  const statusText = settings.on ? (mode === 'practice' ? STATUS_TEXT[status] : 'Spuren spielen nur in Solo üben - im Gig spielt der Track.') : null

  return (
    <div className="flex h-full w-full min-h-0 flex-col gap-3" style={{ fontSize }}>
      <Switch label="Spuren statt Track" checked={settings.on} onChange={(on) => setOn(variantId, on)} />
      {statusText && <p className="text-base text-ink-faint">{statusText}</p>}
      {sets.length > 1 && <Segmented label="Spuren-Satz" size="stage" value={set.key} onChange={(key) => setSet(variantId, key)} options={sets.map((s) => ({ value: s.key, label: s.label }))} />}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {set.stems.map((stem) => {
          const channel = channelOf(settings, stem.id)
          const silent = channel.muted || (anySolo && !channel.solo)
          return (
            <div key={stem.id} className="flex flex-wrap items-center gap-3">
              <div className={`flex min-w-32 flex-1 flex-col gap-1 ${silent ? 'opacity-40' : ''}`}>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-ink">{stem.label}</span>
                  {showValues && <span className="shrink-0 font-sb-mono text-ink-muted">{channel.muted ? 'stumm' : `${percent(channel.level)} %`}</span>}
                </span>
                <input
                  type="range"
                  aria-label={stem.role ? `${stem.label} (${STEM_ROLE_LABELS[stem.role]})` : stem.label}
                  min={0}
                  max={percent(STEM_MAX_LEVEL)}
                  step={5}
                  value={percent(channel.level)}
                  onChange={(e) =>
                    setChannel(variantId, stem.id, {
                      level: Number(e.target.value) / 100,
                    })
                  }
                  style={{ accentColor: 'rgb(var(--sb-accent))' }}
                  className="h-stage w-full"
                />
              </div>
              <ToggleChip label="Stumm" selected={channel.muted} onToggle={(muted) => setChannel(variantId, stem.id, { muted })} size="stage" />
              <ToggleChip label="Solo" selected={channel.solo} onToggle={(solo) => setChannel(variantId, stem.id, { solo })} size="stage" />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function StemsConfigPanel({ config, onChange }: { config: StemsConfig; onChange: (next: StemsConfig) => void }) {
  return <SizeRatioSlider label="Größe" ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO} onChange={(sizeRatio) => onChange({ ...config, sizeRatio })} />
}
