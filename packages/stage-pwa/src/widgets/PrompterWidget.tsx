import { useEffect, useRef } from 'react'
import { isHeadingEntry, isTransitionEntry } from 'shared-types'
import { formatItemSeconds, remainingSeconds } from '../lib/formatItemDuration'
import { ChordProLyrics } from '../components/ChordProLyrics'
import { buildPages, commentVisibleTo, currentLineIndex, currentPageIndex, parseChordPro } from '../lib/chordpro'
import { configLog } from '../lib/configDebug'
import { useActiveProfile } from '../lib/useActiveProfile'
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

export function PrompterWidget({ config }: { config: PrompterConfig }) {
  // The one anchor size - every other element below is a ratio of this, not its own
  // absolute px value (Marco, 2026-09-14), so changing this (globally in Settings, or just
  // for this instance via the shared "Text" control below) rescales everything else with it.
  const fontSize = useContentFontSize(config)
  const titleFontSize = fontSize * (config.titleSizeRatio ?? DEFAULT_TITLE_SIZE_RATIO)
  const artistFontSize = fontSize * (config.artistSizeRatio ?? DEFAULT_ARTIST_SIZE_RATIO)
  const sectionLabelFontSize = fontSize * (config.sectionLabelSizeRatio ?? DEFAULT_SECTION_LABEL_SIZE_RATIO)
  const chordFontSize = fontSize * (config.chordSizeRatio ?? DEFAULT_CHORD_SIZE_RATIO)
  const arrangementInfoFontSize = fontSize * (config.arrangementInfoSizeRatio ?? DEFAULT_ARRANGEMENT_INFO_SIZE_RATIO)
  const commentFontSize = fontSize * (config.commentSizeRatio ?? DEFAULT_COMMENT_SIZE_RATIO)
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
  const lines = currentSong
    ? parseChordPro(chordProContent).filter((line) => commentVisibleTo(line.commentTargets, activeProfile?.name, rosterNames))
    : []

  // Key/Tuning/Capo (SongVariant-only - genuinely arrangement-specific, see songVariant.ts)
  // are important enough to show, but not important enough to sit in the permanently
  // visible header wasting space all show long (Marco, 2026-09-14) - rendered as the first
  // line of the scrolling lyrics content instead, so it scrolls away on its own once
  // playback moves past it, the same way the rest of the song does.
  const arrangementInfo = [
    currentVariant?.key && `Key: ${currentVariant.key}`,
    currentVariant?.tuning && `Tuning: ${currentVariant.tuning}`,
    currentVariant?.capo !== undefined && `Capo: ${currentVariant.capo}. Bund`,
  ]
    .filter((part): part is string => Boolean(part))
    .join('  ·  ')
  const arrangementInfoNode = arrangementInfo ? (
    <p style={{ fontSize: arrangementInfoFontSize }} className="mb-2 uppercase tracking-widest text-ink-faint">
      {arrangementInfo}
    </p>
  ) : null
  const activeIndex = currentLineIndex(lines, elapsedMs ?? 0)
  const pages = buildPages(lines)
  const pageIndex = currentPageIndex(pages, activeIndex)
  const page = pages[pageIndex]

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
      <div className="mb-2 min-w-0">
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
              headerContent={pageIndex === 0 ? arrangementInfoNode : null}
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
            headerContent={arrangementInfoNode}
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
