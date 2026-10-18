import type { Behavior } from './actions'
import type { WidgetColor } from '../widgets/widgetColors'

/**
 * A switch (docs/23 §11): a named, band-wide "Blinder" or "Solo" - its behaviour and actions are
 * set up once, and pedal keys, MIDI buttons and dashboard buttons only point to it. Pressing any
 * of them acts on the switch, and every button bound to it shows its state.
 */
export interface Switch {
  id: string
  name: string
  color: WidgetColor
  /** Never a switch itself. */
  behavior: Behavior
}

/** Pressed (held, or a timed one running), on (latched), off. */
export type SwitchState = 'pressed' | 'on' | 'off'
