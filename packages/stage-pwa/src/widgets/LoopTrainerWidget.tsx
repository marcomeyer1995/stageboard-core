import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { useShowPart } from '../lib/widgetParts'
import { Button, Dialog, Select, Switch } from '../components/ui'
import { parseChordPro } from '../lib/chordpro'
import { getLoopPlaybackState } from '../lib/loopTrainerEngine'
import { formatLoopTime, loopSections } from '../lib/loopSections'
import { startLoopTrainer, stopLoopTrainer } from '../lib/loopTrainer'
import { resolveTrackForEntry } from '../lib/computeQueue'
import { useShowMode } from '../lib/showMode'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_LOOP_CONFIG, useLoopTrainerStore, type LoopTrainerConfig } from '../store/useLoopTrainerStore'
import { usePracticeStateStore, DEFAULT_PRACTICE_STATE } from '../store/usePracticeStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { DEFAULT_SIZE_RATIO, type LoopTrainerWidgetConfig } from './loopTrainerConfig'
import { SizeRatioSlider } from './SizeRatioSlider'
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

/**
 * Rehearsal Looper / Speed Trainer (#61): repeats a section of the backing track gaplessly and,
 * optionally, speeds it up a little on every pass until the target tempo - pitch stays put. Solo
 * Üben only: it slows and loops THIS tablet's own audio and clock, which a band-synced Gig
 * clock must never allow one tablet to do.
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
  // Loading the stretch engine and decoding the track takes seconds on the Fire - say so, or a
  // second tap looks like the obvious thing to do.
  const [starting, setStarting] = useState(false)
  const [tempoOpen, setTempoOpen] = useState(false)
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
  const playing = stored.active ? getLoopPlaybackState() : null
  const canSetPoint = elapsedMs !== null && !stored.active
  const hasLoop = settings.startMs !== null && settings.endMs !== null && settings.endMs > settings.startMs

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto text-sm text-ink-soft">
      {showCaption && <span className="text-xs uppercase tracking-widest text-ink-faint">{t('loop.caption')}</span>}

      <div className="flex items-center gap-2">
        <Button disabled={!canSetPoint} onClick={() => update({ startMs: Math.round(elapsedMs ?? 0) })}>
          {t('loop.setA')}
        </Button>
        <span className="font-bold tabular-nums text-ink">{settings.startMs === null ? '–' : formatLoopTime(settings.startMs)}</span>
        <Button disabled={!canSetPoint} onClick={() => update({ endMs: Math.round(elapsedMs ?? 0) })} className="ml-auto">
          {t('loop.setB')}
        </Button>
        <span className="font-bold tabular-nums text-ink">{settings.endMs === null ? '–' : formatLoopTime(settings.endMs)}</span>
      </div>

      {sections.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <Select
            label={t('loop.from')}
            disabled={stored.active}
            className="min-w-0"
            value=""
            onChange={(e) => e.target.value !== '' && update({ startMs: Number(e.target.value) })}
            options={[{ value: '', label: t('w.choose') }, ...sections.map((section) => ({ value: String(section.startMs), label: section.label }))]}
          />
          <Select
            label={t('loop.to')}
            disabled={stored.active}
            className="min-w-0"
            value=""
            onChange={(e) => e.target.value !== '' && update({ endMs: Number(e.target.value) })}
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
        <Button className="min-w-0 flex-1" disabled={stored.active} onClick={() => setTempoOpen(true)}>
          <span style={{ fontSize }} className="truncate tabular-nums">
            {playing
              ? t('loop.pass', { n: playing.pass + 1, pct: Math.round(playing.rate * 100) })
              : settings.trainerEnabled
                ? t('loop.tempoRange', { from: settings.startPercent, to: settings.targetPercent })
                : t('loop.tempo', { pct: settings.startPercent })}
          </span>
        </Button>
        {stored.active ? (
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
