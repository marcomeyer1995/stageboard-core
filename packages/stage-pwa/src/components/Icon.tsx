import {
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Ban,
  Camera,
  Plus,
  Pencil,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Cloud,
  Star,
  Crown,
  Ellipsis,
  EllipsisVertical,
  ExternalLink,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Maximize2,
  Menu,
  Minimize2,
  NotebookPen,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Square,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react'

/**
 * One line-icon set for the whole app (#379) instead of emoji and Unicode symbols, which rendered
 * differently per device (colour emoji on Android), ignored the theme colour and sat off the text
 * baseline. Named by meaning, not by shape, so the same action always gets the same icon.
 * lucide-react is tree-shaken and bundled, so it works offline like the rest of the UI.
 */
const ICONS = {
  menu: Menu,
  master: Crown,
  locked: Lock,
  unlocked: LockOpen,
  close: X,
  check: Check,
  warning: TriangleAlert,
  syncing: RefreshCw,
  cloud: Cloud,
  rating: Star,
  retry: RotateCw,
  reset: RotateCcw,
  play: Play,
  pause: Pause,
  stop: Square,
  up: ChevronUp,
  down: ChevronDown,
  expand: ChevronRight,
  collapse: ChevronDown,
  previous: ChevronLeft,
  next: ChevronRight,
  back: ArrowLeft,
  forward: ArrowRight,
  external: ExternalLink,
  eye: Eye,
  eyeOff: EyeOff,
  sort: ArrowUpDown,
  fullscreen: Maximize2,
  exitFullscreen: Minimize2,
  more: Ellipsis,
  moreVertical: EllipsisVertical,
  blocked: Ban,
  note: NotebookPen,
  camera: Camera,
  add: Plus,
  edit: Pencil,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS

interface IconProps {
  /** Solid shape - for transport states (■ ▶ ❚❚), which read as states, not outlines like a checkbox. */
  filled?: boolean
  name: IconName
  /** CSS size; defaults to the surrounding font size so the icon scales with its label. */
  size?: string
  className?: string
  /** Set only when the icon stands alone and its parent has no accessible name. */
  label?: string
}

export function Icon({ name, size = '1.1em', className = '', label, filled = false }: IconProps) {
  const Glyph = ICONS[name]
  return (
    <Glyph
      width={size}
      height={size}
      strokeWidth={2.25}
      fill={filled ? 'currentColor' : 'none'}
      className={`inline-block flex-shrink-0 align-[-0.15em] ${className}`}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
    />
  )
}
