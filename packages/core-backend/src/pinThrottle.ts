export interface PinThrottleOptions {
  /** Wrong PINs for one key before it's locked. */
  maxFailures?: number
  /** How long a lock lasts - a fixed, dedicated time: it lifts on its own, nothing to reset. */
  lockoutMs?: number
  /** Upper bound on tracked keys, so probing random ids can't grow the map without limit. */
  maxEntries?: number
  now?: () => number
}

export interface PinThrottle {
  /** Seconds left on this key's lock, `0` when it isn't locked. */
  lockedForSeconds: (key: string) => number
  /** Records a wrong PIN; `true` if this one just triggered the lock. */
  recordFailure: (key: string) => boolean
  /** A correct PIN wipes the key's failure count. */
  recordSuccess: (key: string) => void
}

interface Entry {
  failures: number
  lastFailureAt: number
  lockedUntil: number
}

/**
 * Temporary lockout for guessing a 4-digit admin PIN (10,000 possibilities). After `maxFailures`
 * wrong PINs for one key (a workspace + profile), that key is locked for `lockoutMs` - even the
 * right PIN is refused while locked, otherwise a guesser would just keep going - and then it
 * simply unlocks by itself. Failures that never reached the limit are forgotten after the same
 * time, so a mistyped PIN today doesn't count against tomorrow. In memory on purpose: it only has
 * to slow down guessing, and a server restart clearing it is an acceptable trade for no storage.
 */
export function createPinThrottle(options: PinThrottleOptions = {}): PinThrottle {
  const maxFailures = options.maxFailures ?? 5
  const lockoutMs = options.lockoutMs ?? 5 * 60_000
  const maxEntries = options.maxEntries ?? 500
  const now = options.now ?? (() => Date.now())
  const entries = new Map<string, Entry>()

  function isStale(entry: Entry, t: number): boolean {
    return entry.lockedUntil <= t && t - entry.lastFailureAt > lockoutMs
  }

  return {
    lockedForSeconds(key) {
      const entry = entries.get(key)
      const t = now()
      if (!entry || entry.lockedUntil <= t) return 0
      return Math.ceil((entry.lockedUntil - t) / 1000)
    },

    recordFailure(key) {
      const t = now()
      let entry = entries.get(key)
      // A finished lock, or old scattered failures, start a clean count.
      if (!entry || entry.lockedUntil > 0 && entry.lockedUntil <= t || isStale(entry, t)) {
        entry = { failures: 0, lastFailureAt: t, lockedUntil: 0 }
      }

      if (!entries.has(key) && entries.size >= maxEntries) {
        for (const [k, e] of entries) if (isStale(e, t)) entries.delete(k)
        if (entries.size >= maxEntries) entries.delete(entries.keys().next().value as string)
      }

      entry.failures += 1
      entry.lastFailureAt = t
      const triggersLock = entry.failures >= maxFailures
      if (triggersLock) entry.lockedUntil = t + lockoutMs
      entries.set(key, entry)
      return triggersLock
    },

    recordSuccess(key) {
      entries.delete(key)
    },
  }
}
