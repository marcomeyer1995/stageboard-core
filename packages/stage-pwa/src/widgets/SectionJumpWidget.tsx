import { useMemo, useState } from 'react'
import { isSongEntry } from 'shared-types'
import { Icon } from '../components/Icon'
import { Segmented } from '../components/ui'
import { clickTimeline } from '../lib/beatGrid'
import { songDurationMs } from '../lib/entryDuration'
import { adjustedBpm } from '../lib/metronome'
import { cancelSectionJump, queueSectionJump, setSectionLoop } from '../lib/sectionJump'
import { useShowMode } from '../lib/showMode'
import { sectionIndexAt, showSections, type JumpWhen, type ShowSection } from '../lib/showSections'
import { useShowPart } from '../lib/widgetParts'
import { useShowStateStore } from '../store/useShowStateStore'
import { JumpCrossfadeSetting } from '../components/JumpCrossfadeSetting'

const WHEN_KEY = 'sb:section-jump-when'

function storedWhen(): JumpWhen {
  try {
    return localStorage.getItem(WHEN_KEY) === 'bar' ? 'bar' : 'section'
  } catch {
    return 'section'
  }
}

const BUTTON = 'min-h-touch rounded-control px-4 font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40'

/**
 * Abschnitte (#479): the song's sections from its timeline parts. The master taps one - the band
 * jumps there at the end of the bar or of the section playing (chosen here, remembered on this
 * device), tapped again it is called off. "Wiederholen" repeats the section playing until released.
 * Everyone sees which section plays, which comes next, and a loop. Gig only for now.
 */
export function SectionJumpWidget() {
  const { mode, queue, elapsedMs, playbackStatus } = useShowMode()
  const isMaster = useShowStateStore((state) => state.isMaster)
  const jump = useShowStateStore((state) => state.state.playbackJump ?? null)
  const loop = useShowStateStore((state) => state.state.playbackLoop ?? null)
  const trackOverride = useShowStateStore((state) => state.state.trackOverride)
  const liveTempoAdjustPercent = useShowStateStore((state) => state.state.liveTempoAdjustPercent)
  const [when, setWhen] = useState<JumpWhen>(storedWhen)
  const showWhen = useShowPart('when')
  const showLoop = useShowPart('loop')
  const [message, setMessage] = useState<string | null>(null)

  const { currentEntry, currentSong, currentVariant } = queue
  const song = currentVariant ?? currentSong
  const timeline = useMemo(
    () =>
      song
        ? clickTimeline({
            beatGrid: currentVariant?.beatGrid,
            bpm: adjustedBpm(song.bpm, liveTempoAdjustPercent),
            timeSignature: song.timeSignature,
            countInBars: currentVariant?.countInEnabled ? (currentVariant.countInBars ?? 0) : 0,
          })
        : null,
    [song, currentVariant, liveTempoAdjustPercent],
  )
  const durationMs = currentEntry && isSongEntry(currentEntry) ? (songDurationMs(currentEntry, currentVariant, trackOverride)?.ms ?? null) : null
  const content = currentVariant?.chordProContent ?? currentSong?.chordProContent ?? ''
  const sections = useMemo(() => (timeline ? showSections(content, timeline, durationMs) : []), [content, timeline, durationMs])

  if (mode !== 'gig') return <p className="flex h-full items-center justify-center text-center text-ink-faint">Nur im Gig</p>
  if (!currentSong || sections.length === 0) {
    return <p className="flex h-full items-center justify-center text-center text-ink-faint">Keine Abschnitte mit Zeit in der Timeline</p>
  }

  const playing = playbackStatus === 'playing' && elapsedMs !== null
  const currentIndex = playing ? sectionIndexAt(sections, elapsedMs) : -1
  const current: ShowSection | undefined = sections[currentIndex]
  const canJump = isMaster && playing

  async function tap(section: ShowSection) {
    if (!timeline) return
    setMessage(null)
    if (jump && jump.toMs === section.startMs) {
      await cancelSectionJump()
      return
    }
    const result = await queueSectionJump(section, when, sections, timeline)
    if (result === 'no-boundary') setMessage('Dieser Abschnitt hat kein bekanntes Ende - „Ende Takt“ wählen.')
  }

  function chooseWhen(next: JumpWhen) {
    setWhen(next)
    try {
      localStorage.setItem(WHEN_KEY, next)
    } catch {
      // Storage blocked: the choice holds until the app restarts.
    }
  }

  const status = jump
    ? `Nächster Abschnitt: ${jump.label ?? 'Sprung'}`
    : loop
      ? `Wiederholt: ${loop.label ?? 'Abschnitt'}`
      : !isMaster
        ? 'Springen kann der Master'
        : !playing
          ? 'Springen, während der Song läuft'
          : null

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Abschnitte">
        {sections.map((section, index) => {
          const queued = jump?.toMs === section.startMs
          const isCurrent = index === currentIndex
          return (
            <button
              key={section.startMs}
              type="button"
              disabled={!canJump}
              aria-pressed={queued}
              aria-current={isCurrent ? 'true' : undefined}
              onClick={() => void tap(section)}
              className={`${BUTTON} flex-1 ${queued ? 'bg-accent text-accent-ink' : 'bg-control-strong text-ink [@media(hover:hover)]:hover:bg-control-strong-hover'} ${
                isCurrent ? 'outline outline-2 -outline-offset-2 outline-accent' : ''
              }`}
            >
              {loop && loop.startMs === section.startMs && <Icon name="repeat" className="mr-1 inline" />}
              {section.label}
            </button>
          )
        })}
      </div>
      {(showWhen || showLoop) && isMaster && (
        <div className="flex flex-wrap items-center gap-2">
          {showWhen && (
            <div className="min-w-[14rem] flex-1">
              <Segmented
                label="Springen am"
                value={when}
                size="stage"
                onChange={(value) => chooseWhen(value as JumpWhen)}
                options={[
                  { value: 'bar', label: 'Ende Takt' },
                  { value: 'section', label: 'Ende Abschnitt' },
                ]}
              />
            </div>
          )}
          {showLoop && (
            <button
              type="button"
              disabled={!canJump || (!loop && (!current || current.endMs === null))}
              aria-pressed={loop !== null}
              onClick={() => void setSectionLoop(loop ? null : (current ?? null))}
              className={`${BUTTON} ${loop ? 'bg-accent text-accent-ink' : 'bg-control-strong text-ink'}`}
            >
              <Icon name="repeat" className="mr-1 inline" />
              {loop ? 'Wiederholung beenden' : 'Wiederholen'}
            </button>
          )}
        </div>
      )}
      {(message ?? status) && <p className="text-ink-faint">{message ?? status}</p>}
    </div>
  )
}

/** In the widget's ⋯ menu: the track's crossfade at a jump - a setting of this device, close at hand
 * while trying it out (Marco, 2026-10-17). */
export function SectionJumpConfigPanel() {
  return <JumpCrossfadeSetting />
}
