import type { JobPatch } from './youtubeExtract.js'

/**
 * Progress of a background job, written to the job's document (#964): at most once per interval - every write is a database PUT that only the
 * job's creator watches - and **chained**, so `settled()` can be awaited before the final write: a throttled write still in flight (or retrying
 * on a revision conflict) must never land after `done` and flip a finished job back to `running`.
 */
export function createProgressWriter(options: { patch: (patch: JobPatch) => Promise<void>; intervalMs: number; now: () => number; onError?: (err: unknown) => void }) {
  let writes = Promise.resolve()
  let lastWriteAt = 0
  return {
    /** `fraction` is 0-1. */
    report(fraction: number): void {
      const now = options.now()
      if (now - lastWriteAt < options.intervalMs) return
      lastWriteAt = now
      writes = writes.then(() => options.patch({ status: 'running', progress: fraction }).catch((err) => options.onError?.(err)))
    },
    /** Resolves when every write so far has finished. */
    settled: (): Promise<void> => writes,
  }
}
