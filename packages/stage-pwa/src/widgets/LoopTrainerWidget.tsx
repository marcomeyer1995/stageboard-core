import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { useShowPart } from '../lib/widgetParts'
import { Button, Dialog, Segmented, Select, Switch } from '../components/ui'
import { parseChordPro } from '../lib/chordpro'
import { clickTimeline, type ClickTimeline } from '../lib/beatGrid'
import { loopSections } from '../lib/loopSections'
import { formatLoopPoint, snapLoopPoint, stepLoopPoint, type LoopSnap } from '../lib/loopSnap'
import { startLoopTrainer, stopLoopTrainer, useTrainerLoop } from '../lib/loopTrainer'
import { resolveTrackForEntry } from '../lib/computeQueue'
import { useShowMode } from '../lib/showMode'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_LOOP_CONFIG, useLoopTrainerStore, type LoopTrainerConfig } from '../store/useLoopTrainerStore'
import { usePracticeStateStore, DEFAULT_PRACTICE_STATE } from '../store/usePracticeStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { DEFAULT_SIZE_RATIO, type LoopTrainerWidgetConfig } from './loopTrainerConfig'
import { SizeRatioSlider } from './SizeRatioSlider'
import { SavedLoopsDialog } from './SavedLoopsDialog'
import { loopChanged, loopSettingsOf } from '../lib/savedLoops'
import { useSavedLoopsStore } from '../store/useSavedLoopsStore'
import { stageFontSize } from '../lib/stageSize'

const stepperButton =
  'flex h-form w-12 flex-shrink-0 items-center justify-center rounded-control bg-control-strong text-lg font-bold text-ink [@media(hover:hover)]:hover:bg-control-strong-hover disabled:cursor-not-allowed disabled:opacity-40'

function Stepper({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  disabled?: boolean
  onChange: (next: number) => void
}) {
  const { t } = useTranslation('widgets')
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-ink-faint">{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={t('loop.decrease', { label })} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - step))} className={stepperButton}>
          −
        </button>
        <span className="min-w-12 text-center font-bold tabular-nums text-ink">{value} %</span>
        <button type="button" aria-label={t('loop.increase', { label })} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + step))} className={stepperButton}>
          +
        </button>
      </div>
    </div>
  )
}

/** One loop point: set it from the playhead, then move it by one bar, beat or time step. */
function LoopPoint({
  setLabel,
  name,
  ms,
  snap,
  timeline,
  canSet,
  disabled,
  min,
  max,
  onSet,
  onChange,
}: {
  setLabel: string
  name: string
  ms: number | null
  snap: LoopSnap
  timeline: ClickTimeline | null
  canSet: boolean
  disabled: boolean
  min: number
  max: number
  onSet: () => void
  onChange: (next: number) => void
}) {
  const { t } = useTranslation('widgets')
  const step = (direction: 1 | -1) => (ms === null ? null : stepLoopPoint(timeline, ms, snap, direction))
  const down = step(-1)
  const up = step(1)
  const readout =
    ms === null ? '–' : snap === 'free' || !timeline ? formatLoopPoint(timeline, ms, snap) : t('loop.barAt', { at: formatLoopPoint(timeline, ms, snap) })
  return (
    <div className="flex items-center gap-2">
      <Button disabled={!canSet} onClick={onSet} className="min-w-0 flex-1">
        {setLabel}
      </Button>
      <button
        type="button"
        aria-label={t('loop.decrease', { label: name })}
        disabled={disabled || down === null || down < min || down === ms}
        onClick={() => down !== null && onChange(down)}
        className={stepperButton}
      >
        −
      </button>
      <span className="min-w-16 text-center font-bold tabular-nums text-ink">{readout}</span>
      <button
        type="button"
        aria-label={t('loop.increase', { label: name })}
        disabled={disabled || up === null || up > max}
        onClick={() => up !== null && onChange(up)}
        className={stepperButton}
      >
        +
      </button>
    </div>
  )
}

/**
 * Rehearsal Looper / Speed Trainer (#61): repeats a range of the song and, optionally, speeds it
 * up a little on every pass until the target tempo - pitch stays put. Since #683 it is Solo Üben's
 * section loop with its own range and speed: track or stems with Mein Mix, and the click, all
 * play it. Solo Üben only: it slows THIS tablet's own clock, which a band-synced Gig clock must
 * never allow one tablet to do.
 */
export function LoopTrainerWidget({ config }: { config: LoopTrainerWidgetConfig }) {
  const { t } = useTranslation('widgets')
  // Parts left out under "Anzeigen" in the ⋯ menu (Marco, 2026-10-17: declutter every widget).
  const showCaption = useShowPart('caption')
  const { mode, queue, elapsedMs } = useShowMode()
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const trackOverride = usePracticeStateStore((state) => (state.byWorkspace[workspaceId] ?? DEFAULT_PRACTICE_STATE).trackOverride)
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const stored = useLoopTrainerStore((state) => state)
  const running = useTrainerLoop()
  // Loading the stretcher takes a moment on the Fire - say so, or a second tap looks like the
  // obvious thing to do.
  const [starting, setStarting] = useState(false)
  const [tempoOpen, setTempoOpen] = useState(false)
  const [savedOpen, setSavedOpen] = useState(false)
  const savedLoops = useSavedLoopsStore((state) => state.loops)
  const fontSize = stageFontSize(baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO))

  if (mode !== 'practice') {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-ink-faint">
        {t('loop.onlyPractice')}
      </div>
    )
  }

  const { currentEntry, currentSong, currentVariant } = queue
  const track = resolveTrackForEntry(currentEntry, currentVariant, trackOverride)
  if (!currentEntry || !currentSong || !currentVariant || !track) {
    return <div className="flex h-full items-center justify-center text-center text-sm text-ink-faint">{t('w.noTrack')}</div>
  }

  const entryId = currentEntry.id
  const settings: LoopTrainerConfig = stored.entryId === entryId ? stored.config : DEFAULT_LOOP_CONFIG
  const update = (patch: Partial<LoopTrainerConfig>) => stored.setConfig(entryId, patch)
  const sections = loopSections(parseChordPro(currentVariant.chordProContent), track.durationMs ?? null)
  const active = running !== null
  const playing = running
  const canSetPoint = elapsedMs !== null && !active
  const hasLoop = settings.startMs !== null && settings.endMs !== null && settings.endMs > settings.startMs
  const variantLoops = savedLoops.filter((loop) => loop.variantId === currentVariant.id)
  // Deleted on another tablet: the setting stays, it is just not a saved one any more.
  const loadedLoop = variantLoops.find((loop) => loop.id === settings.savedLoopId) ?? null
  // The variant's grid, as the click plays it - A and B land on its lines (#683).
  const timeline = currentVariant.bpm > 0 ? clickTimeline({ beatGrid: currentVariant.beatGrid, bpm: currentVariant.bpm, timeSignature: currentVariant.timeSignature }) : null
  // Without a tempo there is no grid to snap to.
  const snap: LoopSnap = timeline ? settings.snap : 'free'
  const trackEndMs = track.durationMs ?? Number.POSITIVE_INFINITY
  const snapped = (ms: number) => Math.min(trackEndMs, snapLoopPoint(timeline, ms, settings.snap))
  // A new mode moves both points onto its lines at once, so what is shown is what loops.
  const changeSnap = (snap: LoopSnap) =>
    update({
      snap,
      startMs: settings.startMs === null ? null : Math.min(trackEndMs, snapLoopPoint(timeline, settings.startMs, snap)),
      endMs: settings.endMs === null ? null : Math.min(trackEndMs, snapLoopPoint(timeline, settings.endMs, snap)),
    })

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto text-sm text-ink-soft">
      {showCaption && <span className="text-xs uppercase tracking-widest text-ink-faint">{t('loop.caption')}</span>}

      {/* Saved loops of this variant, band-wide (#683 step 3): the recalled one by name, marked
          while it has changes not saved yet. */}
      <Button disabled={active} icon="repeat" onClick={() => setSavedOpen(true)}>
        <span className="truncate">
          {loadedLoop ? (loopChanged(settings, loadedLoop) ? t('loop.loadedChanged', { name: loadedLoop.name }) : loadedLoop.name) : t('loop.savedButton', { count: variantLoops.length })}
        </span>
      </Button>

      <Segmented
        label={t('loop.snap')}
        value={snap}
        onChange={changeSnap}
        options={(['bars', 'beats', 'free'] as const).map((value) => ({ value, label: t(`loop.snapModes.${value}`), disabled: active || (value !== 'free' && !timeline) }))}
      />
      <LoopPoint
        setLabel={t('loop.setA')}
        name="A"
        ms={settings.startMs}
        snap={snap}
        timeline={timeline}
        canSet={canSetPoint}
        disabled={active}
        min={0}
        max={(settings.endMs ?? trackEndMs) - 1}
        onSet={() => update({ startMs: snapped(elapsedMs ?? 0) })}
        onChange={(startMs) => update({ startMs })}
      />
      <LoopPoint
        setLabel={t('loop.setB')}
        name="B"
        ms={settings.endMs}
        snap={snap}
        timeline={timeline}
        canSet={canSetPoint}
        disabled={active}
        min={(settings.startMs ?? 0) + 1}
        max={trackEndMs}
        onSet={() => update({ endMs: snapped(elapsedMs ?? 0) })}
        onChange={(endMs) => update({ endMs })}
      />

      {sections.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <Select
            label={t('loop.from')}
            disabled={active}
            className="min-w-0"
            value=""
            onChange={(e) => e.target.value !== '' && update({ startMs: snapped(Number(e.target.value)) })}
            options={[{ value: '', label: t('w.choose') }, ...sections.map((section) => ({ value: String(section.startMs), label: section.label }))]}
          />
          <Select
            label={t('loop.to')}
            disabled={active}
            className="min-w-0"
            value=""
            onChange={(e) => e.target.value !== '' && update({ endMs: snapped(Number(e.target.value)) })}
            options={[
              { value: '', label: t('w.choose') },
              ...sections.filter((section) => section.endMs !== null).map((section) => ({ value: String(section.endMs ?? 0), label: section.label })),
            ]}
          />
        </div>
      )}

      {/* Tempo and Speed Trainer behind a button (Marco, 2026-10-22): seven rows never fit the
          widget, and a dashboard never scrolls. While the loop runs the button shows its progress. */}
      <div className="mt-auto flex items-center gap-2">
        <Button className="min-w-0 flex-1" disabled={active} onClick={() => setTempoOpen(true)}>
          <span style={{ fontSize }} className="truncate tabular-nums">
            {playing
              ? t('loop.pass', { n: playing.pass + 1, pct: Math.round(playing.rate * 100) })
              : settings.trainerEnabled
                ? t('loop.tempoRange', { from: settings.startPercent, to: settings.targetPercent })
                : t('loop.tempo', { pct: settings.startPercent })}
          </span>
        </Button>
        {active ? (
          <Button className="min-w-0 flex-1" variant="primary" icon="stop" onClick={stopLoopTrainer}>
            {t('loop.stop')}
          </Button>
        ) : (
          <Button
            className="min-w-0 flex-1"
            variant="primary"
            icon="play"
            disabled={!hasLoop || starting}
            onClick={() => {
              setStarting(true)
              void startLoopTrainer().finally(() => setStarting(false))
            }}
          >
            {starting ? t('loop.starting') : t('loop.start')}
          </Button>
        )}
      </div>

      {stored.error && <p className="text-xs text-danger">{stored.error}</p>}

      {savedOpen && (
        <SavedLoopsDialog
          variantId={currentVariant.id}
          settings={settings}
          timeline={timeline}
          onLoad={(loop) => update({ ...loopSettingsOf(loop), savedLoopId: loop.id })}
          onClose={() => setSavedOpen(false)}
        />
      )}

      {tempoOpen && (
        <Dialog title={t('loop.tempoTitle')} onClose={() => setTempoOpen(false)}>
          <div className="flex flex-col gap-3">
            <Stepper label={t('loop.tempoLabel')} value={settings.startPercent} min={25} max={150} step={5} onChange={(startPercent) => update({ startPercent })} />
            <Switch label={t('loop.trainer')} checked={settings.trainerEnabled} onChange={(trainerEnabled) => update({ trainerEnabled })} />
            {settings.trainerEnabled && (
              <>
                <Stepper label={t('loop.target')} value={settings.targetPercent} min={25} max={150} step={5} onChange={(targetPercent) => update({ targetPercent })} />
                <Stepper label={t('loop.step')} value={settings.stepPercent} min={1} max={20} step={1} onChange={(stepPercent) => update({ stepPercent })} />
              </>
            )}
          </div>
        </Dialog>
      )}
    </div>
  )
}

export function LoopTrainerConfigPanel({
  config,
  onChange,
}: {
  config: LoopTrainerWidgetConfig
  onChange: (next: LoopTrainerWidgetConfig) => void
}) {
  const { t } = useTranslation('widgets')
  return (
    <SizeRatioSlider
      label={t('loop.passDisplay')}
      ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
      onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
    />
  )
}
