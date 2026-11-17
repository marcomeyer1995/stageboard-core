import type { ReactNode } from 'react'
import { DEFAULT_TRANSITION_DELAY_MS, type TransitionType } from 'shared-types'
import { useTranslation } from 'react-i18next'
import { Icon, type IconName } from './Icon'
import { FOCUS } from './ui/styles'

/** One icon per transition kind, the same everywhere (#873, Marco 2026-11-14). */
const TRANSITION_ICON: Record<TransitionType, IconName> = {
  manual: 'transitionManual',
  'next-ready': 'transitionNextReady',
  seamless: 'transitionSeamless',
  delayed: 'transitionDelayed',
}

const TRANSITION_LABEL = {
  manual: 'tr.manual',
  'next-ready': 'tr.nextReady',
  seamless: 'tr.seamless',
  delayed: 'tr.delayed',
} as const satisfies Record<TransitionType, string>

/** The transition between two entries: visually a chip on their seam, not a property of the
 * upper card (#873). Read-only in the preview; a button that opens the picker in the editor. */
export function SetlistTransitionChip({
  type,
  delayMs = DEFAULT_TRANSITION_DELAY_MS,
  isItem = false,
  onPress,
}: {
  type: TransitionType
  delayMs?: number
  /** A program item's transition applies after its countdown, not at a song's end. */
  isItem?: boolean
  onPress?: () => void
}) {
  const { t } = useTranslation('library')
  // "30 s Pause" instead of just "Mit Pause": the delay is the useful part at a glance (#873).
  const label =
    type === 'delayed'
      ? t('tr.chipDelay', { s: Math.round(delayMs / 1000) })
      : t(TRANSITION_LABEL[type])
  const title = t(isItem ? 'tr.afterItem' : 'tr.buttonTitle', { label })
  const content = (
    <>
      <Icon name={TRANSITION_ICON[type]} />
      <span>{label}</span>
    </>
  )
  // One fixed width for every kind (Marco, 2026-11-17) and the same white as the other chips:
  // "Manuell" used to be dimmed, which read as disabled.
  const className =
    'inline-flex h-prep w-40 max-w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-control border border-line bg-control-strong px-3 text-sm text-ink shadow-sb sb-hit'

  if (!onPress) {
    return (
      <span className={`${className} pointer-events-none`} title={title}>
        {content}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={onPress}
      title={title}
      className={`${className} ${FOCUS} [@media(hover:hover)]:hover:bg-control-strong-hover`}
    >
      {content}
    </button>
  )
}

/** Places the chip on the seam between this entry and the one below it, centred in the left third
 * of the row (Marco, 2026-11-17). The parent `<li>` must be `relative`; the list's 16 px gap
 * (`gap-4`) plus `mt-2` centres the 40 px chip on the seam with ~12 px overlap either side, while
 * the entries' extra vertical padding keeps the text at its distance (Marco, 2026-11-17).
 * `sb-hit` makes the touch target 48 px without growing the row. */
export function SetlistTransitionSeam({ children }: { children: ReactNode }) {
  return (
    <div className="absolute left-1/3 top-full z-content mt-2 -translate-x-1/2 -translate-y-1/2">
      {children}
    </div>
  )
}
