import i18n from '../i18n'
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

export type PlaybackOp = 'click-on' | 'click-off' | 'click-toggle' | 'click-song' | 'tempo-up' | 'tempo-down' | 'tempo-reset' | 'ready-check'

export type Action =
  | { kind: 'show'; op: ShowOp }
  | { kind: 'by-state'; steps: Record<SongState, StepAction> }
  /** Sections by their name (Marco, 2026-10-18): "Chorus" fits every song with a chorus. */
  | { kind: 'section'; op: SectionOp; label?: string; when?: JumpWhen }
  | { kind: 'playback'; op: PlaybackOp }
  | { kind: 'device'; targetLogicalDeviceId: string; type: string; payload: Record<string, unknown> }
  /** "Folge" (docs/23 §11.2): several actions with waits between them, kept right here - to reuse
   * one, make it a switch. Replaced the named, separately stored "Abläufe" (Marco, 2026-10-18). */
  | { kind: 'steps'; steps: SequenceStep[] }

export type WaitUnit = 'ms' | 'beats' | 'bars'

/** One step of a Folge: the wait before it (none for the first) and its action. */
export interface SequenceStep {
  wait: { amount: number; unit: WaitUnit } | null
  action: Action
}

/** What happens when a pressed trigger is let go (docs/23 §4a). */
export type Release =
  | { kind: 'none' }
  | { kind: 'on-release'; action: Action }
  /** "Zeitgesteuert": after a time or a number of beats/bars, whenever the key is let go.
   * `onGrid` ("auf den Takt"): on the bar line (beat) that many bars after the nearest one,
   * planned ahead like a cue - else a timer at the tempo of the press. */
  | { kind: 'after'; amount: number; unit: 'ms' | 'beats' | 'bars'; action: Action; onGrid?: boolean }

/** Tastend (press + optional release), rastend (first press A, second press B) - or a pointer to
 * a band-wide switch that holds its own behaviour (docs/23 §11). */
export type Behavior =
  | { kind: 'momentary'; press: Action; release: Release }
  | { kind: 'latching'; on: Action; off: Action }
  | { kind: 'switch'; switchId: string }

export const SECTION_OPS: { id: SectionOp; label: string }[] = [
  { id: 'jump', get label() { return i18n.t('actions:section.jump') } },
  { id: 'next', get label() { return i18n.t('actions:section.next') } },
  { id: 'previous', get label() { return i18n.t('actions:section.previous') } },
  { id: 'loop-toggle', get label() { return i18n.t('actions:section.loop-toggle') } },
  { id: 'loop-on', get label() { return i18n.t('actions:section.loop-on') } },
  { id: 'loop-off', get label() { return i18n.t('actions:section.loop-off') } },
  { id: 'cancel', get label() { return i18n.t('actions:section.cancel') } },
]

export const PLAYBACK_OPS: { id: PlaybackOp; label: string }[] = [
  { id: 'click-on', get label() { return i18n.t('actions:playback.click-on') } },
  { id: 'click-off', get label() { return i18n.t('actions:playback.click-off') } },
  { id: 'click-toggle', get label() { return i18n.t('actions:playback.click-toggle') } },
  { id: 'click-song', get label() { return i18n.t('actions:playback.click-song') } },
  { id: 'tempo-up', get label() { return i18n.t('actions:playback.tempo-up') } },
  { id: 'tempo-down', get label() { return i18n.t('actions:playback.tempo-down') } },
  { id: 'tempo-reset', get label() { return i18n.t('actions:playback.tempo-reset') } },
  { id: 'ready-check', get label() { return i18n.t('actions:playback.ready-check') } },
]

export const WHEN_LABEL: Record<JumpWhen, string> = {
  get bar() {
    return i18n.t('actions:when.bar')
  },
  get section() {
    return i18n.t('actions:when.section')
  },
}

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
      const base = action.op === 'jump' ? i18n.t('actions:jumpTo', { label: action.label ?? '?' }) : (SECTION_OPS.find((o) => o.id === action.op)?.label ?? action.op)
      return sectionOpJumps(action.op) && action.when ? `${base} ${WHEN_LABEL[action.when]}` : base
    }
    case 'playback':
      return PLAYBACK_OPS.find((o) => o.id === action.op)?.label ?? action.op
    case 'device':
      return `${deviceName(action.targetLogicalDeviceId)}: ${action.type}`
    case 'steps':
      return describeSteps(action.steps, (step) => describeAction(step, deviceName))
  }
}

const unitLabel = (unit: WaitUnit, amount = 2): string =>
  unit === 'ms' ? i18n.t('actions:unit.ms') : amount === 1 ? i18n.t(unit === 'bars' ? 'actions:unit.bar' : 'actions:unit.beat') : i18n.t(`actions:unit.${unit}`)

/** "Klick an → 1 Takt → Klick aus" - a Folge in one line, `describe` naming each step. */
export function describeSteps(steps: readonly SequenceStep[], describe: (action: Action) => string): string {
  return steps
    .map((step) => (step.wait ? `${step.wait.amount} ${unitLabel(step.wait.unit, step.wait.amount)} → ` : '') + describe(step.action))
    .join(' → ')
}

/** " auf den Takt" / " auf den Schlag" for a release planned on the grid. */
export function gridLabel(release: Extract<Release, { kind: 'after' }>): string {
  return release.onGrid && release.unit !== 'ms' ? i18n.t(release.unit === 'bars' ? 'actions:onBar' : 'actions:onBeat') : ''
}

/** A whole mapping in one line. */
export function describeBehavior(behavior: Behavior, deviceName?: (id: string) => string): string {
  if (behavior.kind === 'switch') return i18n.t('actions:switch')
  if (behavior.kind === 'latching') return `${describeAction(behavior.on, deviceName)} / ${describeAction(behavior.off, deviceName)}`
  const press = describeAction(behavior.press, deviceName)
  const { release } = behavior
  if (release.kind === 'on-release') return i18n.t('actions:release', { press, action: describeAction(release.action, deviceName) })
  if (release.kind === 'after')
    return i18n.t('actions:after', { press, amount: release.amount, unit: unitLabel(release.unit), grid: gridLabel(release), action: describeAction(release.action, deviceName) })
  return press
}

/** Whether an action is show control - only for who may control the show (docs/23 §5a). Paging
 * the prompter only moves this screen. */
export function needsShowControl(action: Action): boolean {
  // A Folge's steps are checked one by one when they run.
  if (action.kind === 'device' || action.kind === 'steps') return false
  if (action.kind === 'show') return action.op !== 'prompter-down' && action.op !== 'prompter-up'
  return true
}
