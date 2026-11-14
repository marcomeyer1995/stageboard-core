import type { SourceSide } from '../audioMix'
import { nativeEngine, useNativeOutputStore } from '../nativeOutput'
import type { TransportState } from '../playbackTransport'

/**
 * The engine core in the native callback has more than one user (docs/30 §8h stages 3-4): the
 * click (nativeEngineClick.ts) and the track (nativeEngineTrack.ts). It runs while either needs
 * it; the transport goes from here, once per change - "Klick aus" must not stop the track.
 */

export type NativeEngineUser = 'click' | 'track' | 'voice'

const STATUS = { stopped: 0, playing: 1, paused: 2 } as const
/** engine.h Feed. */
export const FEED = { left: 0, right: 1, mix: 2, none: 3 } as const
type FeedValue = (typeof FEED)[keyof typeof FEED]

const users = new Set<NativeEngineUser>()
let sentTransport = ''

export function nativeTransport(t: TransportState) {
  const rate = t.rate ?? 1
  const jump = t.jump ?? null
  // Playing without a start time stands still, as in computeActiveMs.
  const status = t.status === 'playing' && t.startedAt === null ? STATUS.paused : STATUS[t.status]
  return { status, startedAt: t.startedAt ?? 0, accumulatedMs: t.accumulatedMs, rate, hasJump: jump !== null, jumpAt: jump?.at ?? 0, jumpToMs: jump?.toMs ?? 0, jumpRate: jump?.rate ?? rate }
}

/** The transport to the engine - only when it changed (click and track both send it). */
export function sendNativeTransport(t: TransportState): void {
  const n = nativeTransport(t)
  const key = JSON.stringify(n)
  if (key === sentTransport) return
  sentTransport = key
  nativeEngine.transport(n)
}

export function acquireNativeEngine(user: NativeEngineUser): void {
  if (users.has(user)) return
  users.add(user)
  if (users.size === 1) nativeEngine.enable(true)
}

/** The last user gone: the engine stops at once. */
export function releaseNativeEngine(user: NativeEngineUser): void {
  if (!users.delete(user) || users.size > 0) return
  sendNativeTransport({ status: 'stopped', startedAt: null, accumulatedMs: 0 })
  nativeEngine.enable(false)
  sentTransport = ''
}

/** Transport time - wall clock for the callback: the clock the transport is on (the server's in
 * the Gig, this device's in Solo Üben) minus the wall clock, plus the trim beyond the pipe's own
 * delay (`outputLatencyMs` is delay + trim while the native output plays). */
export function bandOffsetMs(transportNow: number, wallNow: number, outputLatencyMs: number, pipeDelayMs: number): number {
  return transportNow - wallNow + (outputLatencyMs - pipeDelayMs)
}

export function sendNativeOffset(transportNow: () => number, outputLatencyMs: number | undefined): void {
  const delayMs = useNativeOutputStore.getState().delayMs ?? 0
  nativeEngine.offset(bandOffsetMs(transportNow(), Date.now(), outputLatencyMs ?? delayMs, delayMs))
}

const FEED_OF = { L: FEED.left, R: FEED.right, mix: FEED.mix } as const

/** A source's place in the output plan (#742) as the engine's two feeds - silent where the plan
 * says so (never a wrong signal). */
export function feedsOf(place: SourceSide): [FeedValue, FeedValue] {
  if (place === null) return [FEED.none, FEED.none]
  return [place.left === null ? FEED.none : FEED_OF[place.left], place.right === null ? FEED.none : FEED_OF[place.right]]
}

/** Test-only reset of the module state. */
export function __resetNativeEngineSessionForTests(): void {
  users.clear()
  sentTransport = ''
}
