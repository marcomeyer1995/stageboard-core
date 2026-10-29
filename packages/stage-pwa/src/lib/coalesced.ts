/**
 * Runs `task` one at a time: a call while it runs only marks it to run once more afterwards, so
 * any number of calls in between cost one extra run, not one each.
 *
 * Why (2026-10-27, Redmi after a night offline): the stores re-read their whole collection on
 * every replicated change. Catching up on ~1000 show-log events started ~20 full reads a second
 * side by side - main thread at 94 %, track, click and Prompter stuttered, and the catch-up itself
 * crawled at about one document a second. The last run always starts after the last change, so
 * the store still ends on the newest data. The run after a busy one waits `gapMs` first, so a
 * steady stream of changes can't keep the main thread reading back to back either.
 */
export function coalesced(task: () => Promise<unknown>, gapMs = 250): () => void {
  let running = false
  let again = false
  const run = () => {
    if (running) {
      again = true
      return
    }
    running = true
    void task()
      .catch((err: unknown) => console.error('[coalesced] refresh failed', err))
      .finally(() => {
        running = false
        if (!again) return
        again = false
        running = true
        setTimeout(() => {
          running = false
          run()
        }, gapMs)
      })
  }
  return run
}
