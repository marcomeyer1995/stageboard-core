import {
  ArrowLeft,
  Power,
  PowerOff,
  Repeat,
  ArrowRight,
  ArrowUpDown,
  AudioWaveform,
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
  FileText,
  Eye,
  Trash2,
  Split,
  SlidersHorizontal,
  EyeOff,
  Grip,
  Minus,
  LayoutDashboard,
  Info,
  Library,
  ListMusic,
  Redo2,
  Undo2,
  Settings,
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
  Save,
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
  /** Bento menu (nine dots): pick and manage dashboards (docs/15 D8). */
  dashboards: Grip,
  /** The three views in the ☰ drawer. */
  boards: LayoutDashboard,
  library: Library,
  system: Settings,
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
  /** Steppers (− / +), unlike "add" a new entry. */
  decrease: Minus,
  increase: Plus,
  edit: Pencil,
  /** Make a setlist the active one / stop it being active. */
  activate: Power,
  deactivate: PowerOff,
  delete: Trash2,
  // Spuren trennen (#9): one track forking into several (Marco, 2026-10-20).
  split: Split,
  /** A section repeated in the show (#479). */
  repeat: Repeat,
  /** Phone headers, where the word doesn't fit (#603): Speichern, and the editor's Text / Timeline view. */
  save: Save,
  text: FileText,
  timeline: AudioWaveform,
  details: SlidersHorizontal,
  /** An explanation behind it (docs/15 D12). */
  info: Info,
  undo: Undo2,
  redo: Redo2,
  /** Song is in the active setlist - a quiet marker in the song list (2026-10-20). */
  setlist: ListMusic,
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
