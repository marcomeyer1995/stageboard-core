import { useElapsedMs } from '../lib/useElapsedMs'
import { useClockStore } from '../store/useClockStore'

function formatClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function ClockControlWidget() {
  const isRunning = useClockStore((state) => state.isRunning)
  const start = useClockStore((state) => state.start)
  const stop = useClockStore((state) => state.stop)
  const reset = useClockStore((state) => state.reset)
  const elapsedMs = useElapsedMs()

  return (
    <div className="flex items-center gap-3 rounded-lg bg-neutral-900 px-4 py-3 text-sm text-neutral-300">
      <span className="font-mono text-lg text-white">{formatClock(elapsedMs)}</span>
      <button
        type="button"
        onClick={isRunning ? stop : start}
        className="rounded bg-neutral-700 px-3 py-1 font-medium text-white hover:bg-neutral-600"
      >
        {isRunning ? 'Stop' : 'Start'}
      </button>
      <button
        type="button"
        onClick={reset}
        className="rounded bg-neutral-700 px-3 py-1 font-medium text-white hover:bg-neutral-600"
      >
        Reset
      </button>
    </div>
  )
}
