/**
 * The app's inbox for pushed state (docs/26 §3.1): audio and drawing come first, everything that
 * only keeps a status fresh is applied in free time.
 *
 * A channel hands in its newest value; only the newest per channel is kept ("the newest wins"),
 * and it is applied in an idle slice between frames - at the latest after `maxDelayMs`. Why
 * (Redmi, 2026-10-28): the Stage-Server sends the plugin status once per plugin heartbeat, 7 in a
 * row every 5 s, and each one re-rendered everything showing a status - an ~80 ms freeze that made
 * the timeline jerk. Whatever a producer sends, it can't take the frame away any more.
 *
 * Only for state whose timing doesn't matter to the millisecond. Show state, switches, triggers and
 * OSC input apply at once - their timing is the function.
 */

/** How long a background value may wait for free time at most. */
export const BACKGROUND_MAX_DELAY_MS = 1000
/** Leave this much of an idle slice unused: one more apply could overrun the frame. */
const SLICE_RESERVE_MS = 2

interface Pending {
  apply: () => void
}

const pending = new Map<string, Pending>()
let scheduled: { cancel: () => void } | null = null

type IdleDeadline = { timeRemaining: () => number; didTimeout: boolean }

function schedule(maxDelayMs: number) {
  if (scheduled) return
  const ric = typeof window !== 'undefined' ? window.requestIdleCallback : undefined
  if (typeof ric === 'function') {
    const id = ric(drain, { timeout: maxDelayMs })
    scheduled = { cancel: () => window.cancelIdleCallback(id) }
  } else {
    // No idle callbacks (older WebViews, tests): the next task, so a burst still becomes one apply.
    const id = setTimeout(() => drain({ timeRemaining: () => Infinity, didTimeout: true }), 0)
    scheduled = { cancel: () => clearTimeout(id) }
  }
}

function drain(deadline: IdleDeadline) {
  scheduled = null
  for (const [key, item] of pending) {
    // At least one per slice, so a busy screen still moves on; more only while time is left.
    pending.delete(key)
    try {
      item.apply()
    } catch (err) {
      console.error('[inbox] apply failed', key, err)
    }
    if (!deadline.didTimeout && deadline.timeRemaining() < SLICE_RESERVE_MS) break
  }
  if (pending.size > 0) schedule(BACKGROUND_MAX_DELAY_MS)
}

/**
 * Hands in the newest value of `channel`: `apply(value)` runs once in free time, with the newest
 * value handed in by then - earlier ones of the same channel are dropped.
 */
export function deliverInBackground<T>(channel: string, value: T, apply: (value: T) => void, maxDelayMs = BACKGROUND_MAX_DELAY_MS): void {
  pending.set(channel, { apply: () => apply(value) })
  schedule(maxDelayMs)
}

/** Drops a channel's waiting value - when its subscription ends, so nothing stale lands later. */
export function dropFromInbox(channel: string): void {
  pending.delete(channel)
}
