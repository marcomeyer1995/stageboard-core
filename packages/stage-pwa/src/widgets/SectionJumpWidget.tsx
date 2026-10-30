import { useTranslation } from 'react-i18next'
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
  const { mode, queue, elapsedMs, playbackStatus, canControl: isMaster, transport, sectionLoop: loop, trackOverride, liveTempoAdjustPercent } = useShowMode()
  const jump = transport.jump ?? null
  const [when, setWhen] = useState<JumpWhen>(storedWhen)
  const showWhen = useShowPart('when')
  const showLoop = useShowPart('loop')
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

  if (!currentSong || sections.length === 0) {
    return <p className="flex h-full items-center justify-center text-center text-ink-faint">{t('sj.none')}</p>
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
        : !playing
          ? t('sj.whilePlaying')
          : null

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('sj.aria')}>
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
      {(message ?? status) && <p className="text-ink-faint">{message ?? status}</p>}
    </div>
  )
}

/** In the widget's ⋯ menu: the track's crossfade at a jump - a setting of this device, close at hand
 * while trying it out (Marco, 2026-10-17). */
export function SectionJumpConfigPanel() {
  return <JumpCrossfadeSetting />
}
