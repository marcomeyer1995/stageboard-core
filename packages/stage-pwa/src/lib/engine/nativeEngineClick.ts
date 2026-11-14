import type { ClickEngineState } from '../clickEngine'
import { mixGain, useOutputPlanStore } from '../audioMix'
import { getServerTime } from '../clockSync'
import { nativeEngine } from '../nativeOutput'
import { createFollower } from './engineClick'
import type { EngineMessage } from './engineMessages'
import { acquireNativeEngine, feedsOf, releaseNativeEngine, sendNativeOffset, sendNativeTransport } from './nativeEngineSession'
import { ENGINE_BUS } from './wasmEngine'

export { bandOffsetMs, nativeTransport } from './nativeEngineSession'

/**
 * The click from the engine core in the native output's callback (docs/30 §8h stage 3) - the same
 * interface as clickEngine.ts, on while the native output plays (`sb:debug:native-click` = 0 switches it off).
 *
 * Unlike the AudioWorklet (engineClick.ts) the clock is not sent from here: the callback has
 * AAudio's timestamp of when each frame is heard, on the wall clock. What it can't know comes from
 * here, now and then: transport time - wall clock (nativeEngineSession.ts) plus what AAudio can't
 * see of the output (the trim, latencyProfiles.ts), and the click's level and place in the output
 * plan. With the plan in the callback the click goes on while the page is throttled - only those
 * small updates wait. The engine itself is shared with the track (nativeEngineSession.ts).
 */

const UPDATE_MS = 1000

/** The engine message as the plugin's calls - the same follower as the worklet uses. */
export function postNative(m: EngineMessage): void {
  if (m.type === 'transport') sendNativeTransport(m.transport)
  else if (m.type === 'beats') nativeEngine.beats(m.songMs, m.accent)
}

export function wantsNativeClick(): boolean {
  try {
    return localStorage.getItem('sb:debug:native-click') !== '0'
  } catch {
    return true
  }
}

let poll: ReturnType<typeof setInterval> | null = null
let update: ReturnType<typeof setInterval> | null = null
let follower: ReturnType<typeof createFollower> | null = null

function sendUpdate(state: ClickEngineState): void {
  // On the transport's clock: in Solo Üben the device's own - with the server's, the click came
  // the device's clock offset early (650 ms on the Redmi, 2026-11-13).
  sendNativeOffset(state.transportNow ?? getServerTime, state.outputLatencyMs)
  nativeEngine.gain(ENGINE_BUS.click, mixGain('click'))
  // Where the plan puts the click (the map, #742) - silent where it says so.
  const [left, right] = feedsOf(useOutputPlanStore.getState().plan.click)
  nativeEngine.feeds(ENGINE_BUS.click, left, right)
}

/** As clickEngine.ts `startClick`: safe to call repeatedly; the state is polled for changes. */
export function startNativeEngineClick(getState: () => ClickEngineState): void {
  if (poll !== null) return
  follower = createFollower(postNative)
  sendUpdate(getState())
  acquireNativeEngine('click')
  follower.update(getState())
  poll = setInterval(() => follower?.update(getState()), 50)
  update = setInterval(() => sendUpdate(getState()), UPDATE_MS)
}

/** As clickEngine.ts `stopClick`: no more beats at once; the engine stops if the track doesn't play. */
export function stopNativeEngineClick(): void {
  if (poll === null) return
  clearInterval(poll)
  if (update !== null) clearInterval(update)
  poll = update = null
  follower = null
  nativeEngine.beats(new Float64Array(0), new Uint8Array(0))
  releaseNativeEngine('click')
}
