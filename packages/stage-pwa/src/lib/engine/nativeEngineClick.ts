import type { ClickEngineState } from '../clickEngine'
import type { TransportState } from '../playbackTransport'
import { mixGain, sideOf, useOutputRoutingStore } from '../audioMix'
import { getServerTime } from '../clockSync'
import { nativeEngine, useNativeOutputStore } from '../nativeOutput'
import { createFollower } from './engineClick'
import type { EngineMessage } from './engineMessages'
import { ENGINE_BUS } from './wasmEngine'

/**
 * The click from the engine core in the native output's callback (docs/30 §8h stage 3) - the same
 * interface as clickEngine.ts, switched by `sb:debug:native-click` while the native output plays.
 *
 * Unlike the AudioWorklet (engineClick.ts) the clock is not sent from here: the callback has
 * AAudio's timestamp of when each frame is heard, on the wall clock. What it can't know comes from
 * here, now and then: band time - wall clock (the server offset) plus what AAudio can't see of the
 * output (the trim, latencyProfiles.ts), and the click's level and side. With the plan in the
 * callback the click goes on while the page is throttled - only those small updates wait.
 */

const UPDATE_MS = 1000
const STATUS = { stopped: 0, playing: 1, paused: 2 } as const

/** The engine message as the plugin's calls - the same follower as the worklet uses. */
export function postNative(m: EngineMessage): void {
  if (m.type === 'transport') nativeEngine.transport(nativeTransport(m.transport))
  else if (m.type === 'beats') nativeEngine.beats(m.songMs, m.accent)
}

export function nativeTransport(t: TransportState) {
  const rate = t.rate ?? 1
  const jump = t.jump ?? null
  // Playing without a start time stands still, as in computeActiveMs.
  const status = t.status === 'playing' && t.startedAt === null ? STATUS.paused : STATUS[t.status]
  return { status, startedAt: t.startedAt ?? 0, accumulatedMs: t.accumulatedMs, rate, hasJump: jump !== null, jumpAt: jump?.at ?? 0, jumpToMs: jump?.toMs ?? 0, jumpRate: jump?.rate ?? rate }
}

/** Band time - wall clock for the callback: the server offset plus the trim beyond the pipe's own
 * delay (`outputLatencyMs` is delay + trim while the native output plays). */
export function bandOffsetMs(serverNow: number, wallNow: number, outputLatencyMs: number, pipeDelayMs: number): number {
  return serverNow - wallNow + (outputLatencyMs - pipeDelayMs)
}

export function wantsNativeClick(): boolean {
  try {
    return localStorage.getItem('sb:debug:native-click') === '1'
  } catch {
    return false
  }
}

let poll: ReturnType<typeof setInterval> | null = null
let update: ReturnType<typeof setInterval> | null = null
let follower: ReturnType<typeof createFollower> | null = null

function sendUpdate(state: ClickEngineState): void {
  const delayMs = useNativeOutputStore.getState().delayMs ?? 0
  nativeEngine.offset(bandOffsetMs(getServerTime(), Date.now(), state.outputLatencyMs ?? delayMs, delayMs))
  nativeEngine.gain(ENGINE_BUS.click, mixGain('click'))
  const side = sideOf('click', useOutputRoutingStore.getState().routing)
  nativeEngine.side(side === 'left' ? 1 : side === 'right' ? 2 : 0)
}

/** As clickEngine.ts `startClick`: safe to call repeatedly; the state is polled for changes. */
export function startNativeEngineClick(getState: () => ClickEngineState): void {
  if (poll !== null) return
  follower = createFollower(postNative)
  sendUpdate(getState())
  nativeEngine.enable(true)
  follower.update(getState())
  poll = setInterval(() => follower?.update(getState()), 50)
  update = setInterval(() => sendUpdate(getState()), UPDATE_MS)
}

/** As clickEngine.ts `stopClick`: the engine stops at once. */
export function stopNativeEngineClick(): void {
  if (poll === null) return
  clearInterval(poll)
  if (update !== null) clearInterval(update)
  poll = update = null
  follower = null
  nativeEngine.transport(nativeTransport({ status: 'stopped', startedAt: null, accumulatedMs: 0 }))
  nativeEngine.enable(false)
}
