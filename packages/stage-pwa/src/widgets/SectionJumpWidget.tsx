import { useTranslation } from 'react-i18next'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { isSongEntry } from 'shared-types'
import { Icon } from '../components/Icon'
import { Segmented } from '../components/ui'
import { clickTimeline } from '../lib/beatGrid'
import { songDurationMs } from '../lib/entryDuration'
import { adjustedBpm } from '../lib/metronome'
import { cancelSectionJump, practiceStartAt, queueSectionJump, setSectionLoop } from '../lib/sectionJump'
import { useShowModeCore } from '../lib/showMode'
import { useFrameValue } from '../lib/useFrameValue'
import { sectionIndexAt, showSections, type JumpWhen, type ShowSection } from '../lib/showSections'
import { useShowPart } from '../lib/widgetParts'
import { useElementSize } from '../lib/useElementSize'
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
 * Everyone sees which section plays, which comes next, and a loop. In Solo Üben the same for this
 * device alone - no master needed (#479, Marco 2026-10-22).
 */
export function SectionJumpWidget() {
  const { t } = useTranslation('widgets')
  const { mode, queue, elapsedNow, playbackStatus, canControl: isMaster, transport, sectionLoop: loop, trackOverride, liveTempoAdjustPercent } = useShowModeCore()
  const jump = transport.jump ?? null
  const [when, setWhen] = useState<JumpWhen>(storedWhen)
  const showWhen = useShowPart('when')
  const showLoop = useShowPart('loop')
  // Too low for its rows (a phone dashboard gave it 49 px, #829): only the section buttons, the
  // full height - a dashboard never scrolls, and a cut-off button is no button. Measured, not a
  // fixed height: stage buttons are bigger on a tablet. For each height the full widget is tried
  // once; if it overflows, it turns compact for that height.
  const [boxRef, box] = useElementSize()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [fit, setFit] = useState({ key: '', compact: false })
  const [message, setMessage] = useState<string | null>(null)

  const { currentEntry, currentSong, currentVariant } = queue
  const song = queue.currentArrangement
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
  const content = song?.chordProContent ?? ''
  const sections = useMemo(() => (timeline ? showSections(content, timeline, durationMs) : []), [content, timeline, durationMs])

  // Measured again for another height or another number of sections (a new song).
  const fitKey = `${box.height}|${sections.length}`
  const compact = fit.key === fitKey && fit.compact
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || box.height === 0 || fit.key === fitKey) return
    setFit({ key: fitKey, compact: root.scrollHeight > root.clientHeight + 1 })
  }, [box.height, fit.key, fitKey])
  const playing = playbackStatus === 'playing' && elapsedNow() !== null
  // Re-renders when the song enters another section, not every frame (#457). Before the early
  // return below - a hook after it crashed the app when a song without sections came first.
  const currentIndex = useFrameValue(() => {
    const elapsedMs = playing ? elapsedNow() : null
    return elapsedMs === null ? -1 : sectionIndexAt(sections, elapsedMs)
  }, playing)

  if (!currentSong || sections.length === 0) {
    return <p className="flex h-full items-center justify-center text-center text-ink-faint">{t('sj.none')}</p>
  }
  const current: ShowSection | undefined = sections[currentIndex]
  // Solo also from a stop: the tap sets where Play starts (#817).
  const startPoint = mode === 'practice' && !playing
  const canJump = (isMaster && playing) || startPoint

  async function tap(section: ShowSection) {
    if (!timeline) return
    setMessage(null)
    if (startPoint) {
      practiceStartAt(section.startMs)
      return
    }
    if (jump && jump.toMs === section.startMs) {
      await cancelSectionJump()
      return
    }
    const result = await queueSectionJump(section, when, sections, timeline)
    if (result === 'no-boundary') setMessage(t('sj.noEnd'))
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
    ? t('sj.next', { name: jump.label ?? t('sj.jump') })
    : loop
      ? t('sj.repeating', { name: loop.label ?? t('w.section') })
      : !isMaster && mode === 'gig'
        ? t('sj.masterOnly')
        : startPoint
          ? t('sj.startPoint')
          : !playing
            ? t('sj.whilePlaying')
          : null

  return (
    <div
      ref={(node) => {
        boxRef(node)
        rootRef.current = node
      }}
      className={`flex h-full flex-col gap-2 ${compact ? 'overflow-hidden' : 'overflow-y-auto'}`}
    >
      <div
        // Compact: a grid that wraps and shares the tile's height between its rows - one squeezed row
        // cut the names of a song with six sections ("Intr", "Chc"; test runner, 2026-11-13).
        className={compact ? 'grid h-full gap-2' : 'flex flex-wrap gap-2'}
        // 110 px, not rem: the stage font made 7.5 rem wider than half a tile - one column of eleven
        // 9 px rows. Rows share the height, never more than they get.
        style={compact ? { gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gridAutoRows: 'minmax(0, 1fr)' } : undefined}
        role="group"
        aria-label={t('sj.aria')}
        title={compact ? (message ?? status ?? undefined) : undefined}
      >
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
              // Compact: the tile's height, not the 56 px stage minimum it cannot hold (#829).
              className={`${compact ? `${BUTTON.replace('min-h-touch ', '')} h-full min-h-0 px-2 [overflow-wrap:anywhere]` : `${BUTTON} flex-1`} ${queued ? 'bg-accent text-accent-ink' : 'bg-control-strong text-ink [@media(hover:hover)]:hover:bg-control-strong-hover'} ${
                isCurrent ? 'outline outline-2 -outline-offset-2 outline-accent' : ''
              }`}
            >
              {loop && loop.startMs === section.startMs && <Icon name="repeat" className="mr-1 inline" />}
              {section.label}
            </button>
          )
        })}
      </div>
      {!compact && (showWhen || showLoop) && isMaster && (
        <div className="flex flex-wrap items-center gap-2">
          {showWhen && (
            <div className="min-w-[14rem] flex-1">
              <Segmented
                label={t('sj.when')}
                value={when}
                size="stage"
                onChange={(value) => chooseWhen(value as JumpWhen)}
                options={[
                  { value: 'bar', label: t('sj.bar') },
                  { value: 'section', label: t('sj.section') },
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
              {loop ? t('sj.stopRepeat') : t('sj.repeat')}
            </button>
          )}
        </div>
      )}
      {!compact && (message ?? status) && <p className="text-ink-faint">{message ?? status}</p>}
    </div>
  )
}

/** In the widget's ⋯ menu: the track's crossfade at a jump - a setting of this device, close at hand
 * while trying it out (Marco, 2026-10-17). */
export function SectionJumpConfigPanel() {
  return <JumpCrossfadeSetting />
}
