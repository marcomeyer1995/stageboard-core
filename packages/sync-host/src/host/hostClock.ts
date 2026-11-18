/**
 * The passive tablet's view of the primary's clock (host backup, #947, docs/25 §6e + docs/29):
 * while it waits it samples the primary's `/time` like any device and keeps the offset. On a
 * takeover it serves band time as its own clock plus that offset, so no device's clock jumps.
 * The estimate is the NTP one stage-pwa's clockSync.ts uses: the sample with the smallest round
 * trip, the primary's reading taken at the midpoint.
 */
export interface TimeSample {
  /** Own clock when the request left and when the answer arrived, ms. */
  t0: number
  t1: number
  /** The primary's clock in its answer, ms. */
  serverTime: number
}

export interface HostClock {
  /** Takes a sample; null (the request failed) changes nothing. */
  add(sample: TimeSample | null): void
  /** The primary's clock minus ours, or null until a sample has come in. */
  offsetMs(): number | null
  /** Band time: own clock plus the offset (just the own clock while there is none). */
  bandTime(): number
}

const DEFAULT_WINDOW_MS = 60_000

export function createHostClock(deps: { now: () => number; windowMs?: number }): HostClock {
  const windowMs = deps.windowMs ?? DEFAULT_WINDOW_MS
  let samples: { rtt: number; offset: number; at: number }[] = []
  // The offset of the last window that had a sample: a primary that has gone silent must not make
  // the offset fall back to 0 - band time would jump by the whole offset (docs/29).
  let lastOffset: number | null = null

  function best(): { offset: number } | null {
    const horizon = deps.now() - windowMs
    samples = samples.filter((s) => s.at >= horizon)
    const winner = samples.reduce<{ rtt: number; offset: number } | null>((acc, s) => (acc === null || s.rtt < acc.rtt ? s : acc), null)
    if (winner) lastOffset = winner.offset
    return lastOffset === null ? null : { offset: lastOffset }
  }

  return {
    add(sample) {
      if (sample === null || sample.t1 < sample.t0) return
      const midpoint = (sample.t0 + sample.t1) / 2
      samples.push({ rtt: sample.t1 - sample.t0, offset: sample.serverTime - midpoint, at: deps.now() })
      best() // remembers the offset of this window before it can age out
    },
    offsetMs: () => best()?.offset ?? null,
    bandTime: () => deps.now() + (best()?.offset ?? 0),
  }
}
