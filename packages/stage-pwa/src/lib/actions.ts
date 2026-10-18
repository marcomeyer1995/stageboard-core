import type { JumpWhen } from './showSections'
import { FIXED_ACTIONS, SONG_STATES, STEP_LABEL, type FixedAction, type SongState, type StepAction } from './keybindings'

/**
 * Actions (docs/23, #547): one building block, whatever fires it - a pedal key now, a MIDI
 * controller and a widget button next. Show, section and playback actions run only where the
 * musician may control the show (the master); device commands from any device, and paging the
 * prompter always (only this screen) - runAction.ts.
 */

export type ShowOp = FixedAction

export type SectionOp = 'jump' | 'next' | 'previous' | 'loop-toggle' | 'loop-on' | 'loop-off' | 'cancel'

export type PlaybackOp = 'click-toggle' | 'tempo-up' | 'tempo-down' | 'tempo-reset' | 'ready-check'

export type Action =
  | { kind: 'show'; op: ShowOp }
  | { kind: 'by-state'; steps: Record<SongState, StepAction> }
  /** Sections by their name (Marco, 2026-10-18): "Chorus" fits every song with a chorus. */
  | { kind: 'section'; op: SectionOp; label?: string; when?: JumpWhen }
  | { kind: 'playback'; op: PlaybackOp }
  | { kind: 'device'; targetLogicalDeviceId: string; type: string; payload: Record<string, unknown> }
  /** A named sequence of actions with waits between them (docs/23 §3 "Ablauf") - band-wide. */
  | { kind: 'sequence'; sequenceId: string }

export type WaitUnit = 'ms' | 'beats' | 'bars'

/** One step of a sequence: the wait before it (none for the first) and its action. */
export interface SequenceStep {
  wait: { amount: number; unit: WaitUnit } | null
  action: Action
}

/** "Ablauf" (docs/23 §3, step 4): e.g. "Solo" - rig 5, a bar later delay on, channel 3 louder.
 * Each step keeps its own rights (§5a). */
export interface ActionSequence {
  id: string
  name: string
  steps: SequenceStep[]
}

/** What happens when a pressed trigger is let go (docs/23 §4a). */
export type Release =
  | { kind: 'none' }
  | { kind: 'on-release'; action: Action }
  /** "Zeitgesteuert": after a time or a number of beats/bars, whenever the key is let go.
   * `onGrid` ("auf den Takt"): on the bar line (beat) that many bars after the nearest one,
   * planned ahead like a cue - else a timer at the tempo of the press. */
  | { kind: 'after'; amount: number; unit: 'ms' | 'beats' | 'bars'; action: Action; onGrid?: boolean }

/** Tastend (press + optional release) or rastend (first press A, second press B). */
export type Behavior = { kind: 'momentary'; press: Action; release: Release } | { kind: 'latching'; on: Action; off: Action }

export const SECTION_OPS: { id: SectionOp; label: string }[] = [
  { id: 'jump', label: 'Springe zu Abschnitt …' },
  { id: 'next', label: 'Nächster Abschnitt' },
  { id: 'previous', label: 'Vorheriger Abschnitt' },
  { id: 'loop-toggle', label: 'Wiederholen an/aus' },
  { id: 'loop-on', label: 'Wiederholen an' },
  { id: 'loop-off', label: 'Wiederholen aus' },
  { id: 'cancel', label: 'Sprung absagen' },
]

export const PLAYBACK_OPS: { id: PlaybackOp; label: string }[] = [
  { id: 'click-toggle', label: 'Klick an/aus' },
  { id: 'tempo-up', label: 'Tempo +1 %' },
  { id: 'tempo-down', label: 'Tempo −1 %' },
  { id: 'tempo-reset', label: 'Tempo zurücksetzen' },
  { id: 'ready-check', label: 'Ready-Check starten' },
]

export const WHEN_LABEL: Record<JumpWhen, string> = { bar: 'am Ende des Takts', section: 'am Ende des Abschnitts' }

/** Whether a section op takes a jump moment. */
export function sectionOpJumps(op: SectionOp): boolean {
  return op === 'jump' || op === 'next' || op === 'previous'
}

/** An action in one line, for lists. `deviceName` names a device command's target. */
export function describeAction(action: Action, deviceName: (id: string) => string = (id) => id): string {
  switch (action.kind) {
    case 'show':
      return FIXED_ACTIONS.find((a) => a.id === action.op)?.label ?? action.op
    case 'by-state':
      return SONG_STATES.filter(({ id }) => action.steps[id] !== 'none')
        .map(({ id, label }) => `${label} → ${STEP_LABEL[action.steps[id]]}`)
        .join(' · ')
    case 'section': {
      const base = action.op === 'jump' ? `Springe zu „${action.label ?? '?'}“` : (SECTION_OPS.find((o) => o.id === action.op)?.label ?? action.op)
      return sectionOpJumps(action.op) && action.when ? `${base} ${WHEN_LABEL[action.when]}` : base
    }
    case 'playback':
      return PLAYBACK_OPS.find((o) => o.id === action.op)?.label ?? action.op
    case 'device':
      return `${deviceName(action.targetLogicalDeviceId)}: ${action.type}`
    case 'sequence':
      return 'Ablauf'
  }
}

const UNIT_LABEL = { ms: 'ms', beats: 'Schläge', bars: 'Takte' } as const

/** " auf den Takt" / " auf den Schlag" for a release planned on the grid. */
export function gridLabel(release: Extract<Release, { kind: 'after' }>): string {
  return release.onGrid && release.unit !== 'ms' ? (release.unit === 'bars' ? ' auf den Takt' : ' auf den Schlag') : ''
}

/** A whole mapping in one line. */
export function describeBehavior(behavior: Behavior, deviceName?: (id: string) => string): string {
  if (behavior.kind === 'latching') return `${describeAction(behavior.on, deviceName)} / ${describeAction(behavior.off, deviceName)}`
  const press = describeAction(behavior.press, deviceName)
  const { release } = behavior
  if (release.kind === 'on-release') return `${press} · Loslassen: ${describeAction(release.action, deviceName)}`
  if (release.kind === 'after') return `${press} · nach ${release.amount} ${UNIT_LABEL[release.unit]}${gridLabel(release)}: ${describeAction(release.action, deviceName)}`
  return press
}

/** Whether an action is show control - only for who may control the show (docs/23 §5a). Paging
 * the prompter only moves this screen. */
export function needsShowControl(action: Action): boolean {
  // A sequence's steps are checked one by one when they run.
  if (action.kind === 'device' || action.kind === 'sequence') return false
  if (action.kind === 'show') return action.op !== 'prompter-down' && action.op !== 'prompter-up'
  return true
}
