import { Button, Select, Switch } from '../components/ui'
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
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-ink-faint">{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`${label} verringern`} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - step))} className={stepperButton}>
          −
        </button>
        <span className="min-w-12 text-center font-bold tabular-nums text-ink">{value} %</span>
        <button type="button" aria-label={`${label} erhöhen`} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + step))} className={stepperButton}>
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
  const { mode, queue, elapsedMs } = useShowMode()
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const trackOverride = usePracticeStateStore((state) => (state.byWorkspace[workspaceId] ?? DEFAULT_PRACTICE_STATE).trackOverride)
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const stored = useLoopTrainerStore((state) => state)
  const fontSize = stageFontSize(baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO))

  if (mode !== 'practice') {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-ink-faint">
        Nur in Solo Üben verfügbar
      </div>
    )
  }

  const { currentEntry, currentSong, currentVariant } = queue
  const track = resolveTrackForEntry(currentEntry, currentVariant, trackOverride)
  if (!currentEntry || !currentSong || !currentVariant || !track) {
    return <div className="flex h-full items-center justify-center text-center text-sm text-ink-faint">Kein Track angehängt</div>
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
      <span className="text-xs uppercase tracking-widest text-ink-faint">Loop-Trainer</span>

      <div className="flex items-center gap-2">
        <Button disabled={!canSetPoint} onClick={() => update({ startMs: Math.round(elapsedMs ?? 0) })}>
          A setzen
        </Button>
        <span className="font-bold tabular-nums text-ink">{settings.startMs === null ? '–' : formatLoopTime(settings.startMs)}</span>
        <Button disabled={!canSetPoint} onClick={() => update({ endMs: Math.round(elapsedMs ?? 0) })} className="ml-auto">
          B setzen
        </Button>
        <span className="font-bold tabular-nums text-ink">{settings.endMs === null ? '–' : formatLoopTime(settings.endMs)}</span>
      </div>

      {sections.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <Select
            label="Von Abschnitt"
            disabled={stored.active}
            className="min-w-0"
            value=""
            onChange={(e) => e.target.value !== '' && update({ startMs: Number(e.target.value) })}
            options={[{ value: '', label: 'wählen…' }, ...sections.map((section) => ({ value: String(section.startMs), label: section.label }))]}
          />
          <Select
            label="Bis Ende von"
            disabled={stored.active}
            className="min-w-0"
            value=""
            onChange={(e) => e.target.value !== '' && update({ endMs: Number(e.target.value) })}
            options={[
              { value: '', label: 'wählen…' },
              ...sections.filter((section) => section.endMs !== null).map((section) => ({ value: String(section.endMs ?? 0), label: section.label })),
            ]}
          />
        </div>
      )}

      <Stepper label="Tempo" value={settings.startPercent} min={25} max={150} step={5} disabled={stored.active} onChange={(startPercent) => update({ startPercent })} />
      <Switch label="Speed Trainer" disabled={stored.active} checked={settings.trainerEnabled} onChange={(trainerEnabled) => update({ trainerEnabled })} />
      {settings.trainerEnabled && (
        <>
          <Stepper label="Ziel" value={settings.targetPercent} min={25} max={150} step={5} disabled={stored.active} onChange={(targetPercent) => update({ targetPercent })} />
          <Stepper label="Pro Durchgang +" value={settings.stepPercent} min={1} max={20} step={1} disabled={stored.active} onChange={(stepPercent) => update({ stepPercent })} />
        </>
      )}

      {stored.active ? (
        <Button variant="primary" icon="stop" onClick={stopLoopTrainer}>
          Loop stoppen
        </Button>
      ) : (
        <Button variant="primary" icon="play" disabled={!hasLoop} onClick={() => void startLoopTrainer()}>
          Loop starten
        </Button>
      )}

      {playing && (
        <p style={{ fontSize }} className="text-center font-bold tabular-nums text-ink">
          Durchgang {playing.pass + 1} · {Math.round(playing.rate * 100)} %
        </p>
      )}
      {stored.error && <p className="text-xs text-danger">{stored.error}</p>}
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
  return (
    <SizeRatioSlider
      label="Durchgang-Anzeige"
      ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
      onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
    />
  )
}
