import { useEffect, useRef } from 'react'
import { isHeadingEntry, isTransitionEntry } from 'shared-types'
import { formatItemSeconds, remainingSeconds } from '../lib/formatItemDuration'
import { ChordOffsetControls } from '../components/ChordOffsetControls'
import { ChordProLyrics } from '../components/ChordProLyrics'
import { buildPages, commentVisibleTo, currentLineIndex, currentPageIndex, parseChordPro } from '../lib/chordpro'
import { configLog } from '../lib/configDebug'
import { transposeLines } from '../lib/transposeChord'
import { isStandardTuning } from '../lib/tuning'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useChordOffsets } from '../lib/useChordOffsets'
import { useContentFontSize } from '../lib/useContentFontSize'
import { useShowMode } from '../lib/showMode'
import { useProfilesStore } from '../store/useProfilesStore'
import { ContentFontSizeConfigPanel } from './ContentFontSizeConfigPanel'
import { SizeRatioSlider } from './SizeRatioSlider'
import {
  DEFAULT_ARRANGEMENT_INFO_SIZE_RATIO,
  DEFAULT_ARTIST_SIZE_RATIO,
  DEFAULT_CHORD_SIZE_RATIO,
  DEFAULT_COMMENT_SIZE_RATIO,
  DEFAULT_SECTION_LABEL_SIZE_RATIO,
  DEFAULT_TITLE_SIZE_RATIO,
  type PrompterConfig,
} from './prompterConfig'
import { stageFontSize } from '../lib/stageSize'
import { PROMPTER_SCROLL_EVENT, type PrompterScrollDetail } from '../lib/keybindings'

export function PrompterWidget({ config }: { config: PrompterConfig }) {
  // The one anchor size - every other element below is a ratio of this, not its own
  // absolute px value (Marco, 2026-09-14), so changing this (globally in Settings, or just
  // for this instance via the shared "Text" control below) rescales everything else with it.
  const fontSize = useContentFontSize(config)
  const titleFontSize = stageFontSize(fontSize * (config.titleSizeRatio ?? DEFAULT_TITLE_SIZE_RATIO))
  const artistFontSize = stageFontSize(fontSize * (config.artistSizeRatio ?? DEFAULT_ARTIST_SIZE_RATIO))
  const sectionLabelFontSize = stageFontSize(fontSize * (config.sectionLabelSizeRatio ?? DEFAULT_SECTION_LABEL_SIZE_RATIO))
  const chordFontSize = stageFontSize(fontSize * (config.chordSizeRatio ?? DEFAULT_CHORD_SIZE_RATIO))
  const arrangementInfoFontSize = stageFontSize(fontSize * (config.arrangementInfoSizeRatio ?? DEFAULT_ARRANGEMENT_INFO_SIZE_RATIO))
  const commentFontSize = stageFontSize(fontSize * (config.commentSizeRatio ?? DEFAULT_COMMENT_SIZE_RATIO))
  // What the widget actually renders, every time `config` prop changes - the ground truth to
  // correlate against the write-pipeline logs above (Marco, 2026-09-14).
  useEffect(() => {
    configLog('PrompterWidget rendering with config ->', config, '| resolved sizes:', {
      fontSize,
      titleFontSize,
      artistFontSize,
      sectionLabelFontSize,
      chordFontSize,
      arrangementInfoFontSize,
      commentFontSize,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- log-only effect, config is the one thing worth keying on
  }, [config])
  // useShowMode already picks the right song/clock for Gig vs. Practice mode - Gig mode's
  // clock is ShowState-synced (every tablet scrolls off the same value), Practice mode's is
  // this device's own local one (usePracticeElapsedMs.ts). Either way, elapsedMs is null
  // whenever nothing is actually playing - frozen at the top of the song, same as page 0.
  const { queue, elapsedMs, playbackStatus } = useShowMode()
  const { currentSong, currentVariant } = queue
  const containerRef = useRef<HTMLDivElement>(null)
  // Who's targeted comments (`{cc4marco:}`, issue #215 follow-up) resolve against - this
  // device's active profile, and the whole roster (so a typo'd/stale target name still fails
  // open instead of silently vanishing forever, see commentVisibleTo's own doc comment).
  const activeProfile = useActiveProfile()
  const rosterNames = useProfilesStore((state) => state.profiles).map((profile) => profile.name)

  // The setlist may have picked a non-default variant for this song (different lyrics/BPM),
  // so the actual content to render comes from the variant, not the Song mirror - falling
  // back to the Song only for a song Phase 1's lazy migration hasn't touched yet.
  const chordProContent = currentVariant?.chordProContent ?? currentSong?.chordProContent ?? ''
  // Filtered before anything else (pagination, section-jump, the scroll effect below) ever
  // sees these lines - a comment not meant for this device simply isn't part of the song, not
  // shown-but-greyed (Marco, issue #215 follow-up).
  const authoredCapo = currentVariant?.capo ?? 0
  const offsets = useChordOffsets(queue.currentEntry?.id ?? null, authoredCapo)
  const baseKey = currentVariant?.key
  // #59: this device's own transpose/capo shift, applied to the chords only (line count and
  // indices stay identical, so pagination and scrolling are unaffected).
  const lines = currentSong
    ? transposeLines(
        parseChordPro(chordProContent).filter((line) => commentVisibleTo(line.commentTargets, activeProfile?.name, rosterNames)),
        offsets.chordShift,
        baseKey,
      )
    : []

  // Key/Tuning/Capo (#410, Marco): no line of their own any more. The key is on the "Tonart"
  // button; capo and a tuning that isn't standard are small chips next to it in the header -
  // in the common case (standard tuning, no capo) nothing at all takes room above the lyrics.
  const chips = [
    offsets.effectiveCapo > 0 && `Capo ${offsets.effectiveCapo}`,
    !isStandardTuning(currentVariant?.tuning) && currentVariant?.tuning,
  ].filter((chip): chip is string => Boolean(chip))
  const activeIndex = currentLineIndex(lines, elapsedMs ?? 0)
  const pages = buildPages(lines)
  const pageIndex = currentPageIndex(pages, activeIndex)
  const page = pages[pageIndex]

  // Foot switch (#27): page the lyrics up/down by most of a screen.
  useEffect(() => {
    const onScroll = (event: Event) => {
      const container = containerRef.current
      if (!container) return
      const { direction } = (event as CustomEvent<PrompterScrollDetail>).detail
      container.scrollBy({ top: direction * container.clientHeight * 0.8, behavior: 'smooth' })
    }
    window.addEventListener(PROMPTER_SCROLL_EVENT, onScroll)
    return () => window.removeEventListener(PROMPTER_SCROLL_EVENT, onScroll)
  }, [])

  useEffect(() => {
    if (config.viewMode !== 'scroll') return
    const container = containerRef.current
    const activeEl = container?.querySelector<HTMLElement>(`[data-line-index="${activeIndex}"]`)
    if (!container || !activeEl) return

    const containerRect = container.getBoundingClientRect()
    const activeRect = activeEl.getBoundingClientRect()
    const target =
      container.scrollTop +
      (activeRect.top - containerRect.top) -
      container.clientHeight / 2 +
      activeRect.height / 2

    // Smooth Scroll: ease continuously toward the active line every tick.
    container.scrollTop += (target - container.scrollTop) * 0.08
  }, [activeIndex, elapsedMs, config.viewMode])

  const currentTransition = queue.currentEntry && isTransitionEntry(queue.currentEntry) ? queue.currentEntry : null
  if (currentTransition) {
    return (
      <div className="flex h-full flex-col gap-2 overflow-y-auto">
        <p className="text-sm uppercase tracking-widest text-ink-faint">
          {isHeadingEntry(currentTransition) ? 'Abschnitt' : 'Ansage'}
        </p>
        <h1
          style={{ fontSize: titleFontSize }}
          className={`break-words font-bold leading-tight ${isHeadingEntry(currentTransition) ? 'text-accent' : 'text-ink'}`}
        >
          {currentTransition.title}
        </h1>
        {currentTransition.estimatedDurationMs ? (
          <p style={{ fontSize: artistFontSize }} className="text-ink-muted">
            {playbackStatus === 'stopped'
              ? `ca. ${formatItemSeconds(currentTransition.estimatedDurationMs)}`
              : `noch ${remainingSeconds(currentTransition.estimatedDurationMs, elapsedMs)} s`}
          </p>
        ) : null}
        {currentTransition.notes ? (
          <p style={{ fontSize }} className="whitespace-pre-wrap break-words text-ink">
            {currentTransition.notes}
          </p>
        ) : null}
      </div>
    )
  }

  if (!currentSong) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint">
        Keine Songs vorhanden
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Song on the left, "Tonart" (transpose/capo, #410) in the free top right corner - so it
          takes no extra line above the lyrics. */}
      <div className="mb-2 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm uppercase tracking-widest text-ink-faint">Now Playing</p>
          <h1
            style={{ fontSize: titleFontSize }}
            className="overflow-hidden break-words font-bold leading-tight text-ink"
          >
            {currentSong.title}
          </h1>
          {currentSong.artist && (
            <p style={{ fontSize: artistFontSize }} className="overflow-hidden break-words text-ink-muted">
              {currentSong.artist}
            </p>
          )}
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
          {chips.map((chip) => (
            <span key={chip} style={{ fontSize: arrangementInfoFontSize }} className="rounded-sb-sm bg-control px-2 py-1 font-semibold text-ink-soft">
              {chip}
            </span>
          ))}
          {queue.currentEntry && <ChordOffsetControls offsets={offsets} authoredCapo={authoredCapo} baseKey={baseKey} />}
        </div>
      </div>

      {config.viewMode === 'paginated' && page ? (
        <>
          <div className="flex items-baseline justify-between gap-2 border-b border-line pb-2">
            <p
              style={{ fontSize: sectionLabelFontSize }}
              className="min-w-0 overflow-hidden break-words font-bold uppercase tracking-widest text-accent"
            >
              {page.label ?? `Seite ${pageIndex + 1}`}
            </p>
            <p className="flex-shrink-0 font-sb-mono text-sm text-ink-faint">
              {pageIndex + 1}/{pages.length}
              {pages[pageIndex + 1]?.label && (
                <span className="ml-3 text-ink-faint">
                  next: {pages[pageIndex + 1].label}
                </span>
              )}
            </p>
          </div>
          {/* One page at a time: the whole block is replaced when the clock crosses into the
              next part, instead of scrolling line by line. */}
          <div className="flex-1 overflow-x-hidden overflow-y-auto">
            <ChordProLyrics
              lines={lines.slice(page.startIndex, page.endIndex)}
              activeIndex={activeIndex}
              startIndex={page.startIndex}
              hidePartLabels
              fontSize={fontSize}
              chordFontSize={chordFontSize}
              commentFontSize={commentFontSize}
            />
          </div>
        </>
      ) : (
        <div ref={containerRef} className="flex-1 overflow-x-hidden overflow-y-auto">
          <ChordProLyrics
            lines={lines}
            activeIndex={activeIndex}
            fontSize={fontSize}
            chordFontSize={chordFontSize}
            commentFontSize={commentFontSize}
          />
        </div>
      )}
    </div>
  )
}

export function PrompterConfigPanel({
  config,
  onChange,
}: {
  config: PrompterConfig
  onChange: (next: PrompterConfig) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        Ansicht
        <select
          className="rounded-sb-sm bg-control px-2 py-1 text-sm text-ink"
          value={config.viewMode}
          onChange={(e) => onChange({ ...config, viewMode: e.target.value as PrompterConfig['viewMode'] })}
        >
          <option value="scroll">Smooth Scroll</option>
          <option value="paginated">Paginated View</option>
        </select>
      </label>

      {/* The one anchor size (device-wide default, or this instance's own absolute
          override) - every slider below is a percentage of whatever this resolves to. */}
      <ContentFontSizeConfigPanel config={config} onChange={(next) => onChange({ ...config, ...next })} />

      <SizeRatioSlider
        label="Chords"
        ratio={config.chordSizeRatio ?? DEFAULT_CHORD_SIZE_RATIO}
        onChange={(chordSizeRatio) => onChange({ ...config, chordSizeRatio })}
      />
      <SizeRatioSlider
        label="Titel"
        ratio={config.titleSizeRatio ?? DEFAULT_TITLE_SIZE_RATIO}
        onChange={(titleSizeRatio) => onChange({ ...config, titleSizeRatio })}
      />
      <SizeRatioSlider
        label="Interpret"
        ratio={config.artistSizeRatio ?? DEFAULT_ARTIST_SIZE_RATIO}
        onChange={(artistSizeRatio) => onChange({ ...config, artistSizeRatio })}
      />
      <SizeRatioSlider
        label="Abschnitt (Paginated View)"
        ratio={config.sectionLabelSizeRatio ?? DEFAULT_SECTION_LABEL_SIZE_RATIO}
        onChange={(sectionLabelSizeRatio) => onChange({ ...config, sectionLabelSizeRatio })}
      />
      <SizeRatioSlider
        label="Key/Tuning/Capo"
        ratio={config.arrangementInfoSizeRatio ?? DEFAULT_ARRANGEMENT_INFO_SIZE_RATIO}
        onChange={(arrangementInfoSizeRatio) => onChange({ ...config, arrangementInfoSizeRatio })}
      />
      <SizeRatioSlider
        label="Kommentare"
        ratio={config.commentSizeRatio ?? DEFAULT_COMMENT_SIZE_RATIO}
        onChange={(commentSizeRatio) => onChange({ ...config, commentSizeRatio })}
      />
    </div>
  )
}
