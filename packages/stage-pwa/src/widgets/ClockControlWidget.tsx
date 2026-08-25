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
    <div className="flex h-full items-center gap-3 text-sm text-ink-soft">
      <span className="font-sb-mono text-lg text-ink">{formatClock(elapsedMs)}</span>
      <button
        type="button"
        onClick={isRunning ? stop : start}
        className="rounded-sb-sm bg-control-strong px-3 py-1 font-medium text-ink hover:bg-control-strong-hover"
      >
        {isRunning ? 'Stop' : 'Start'}
      </button>
      <button
        type="button"
        onClick={reset}
        className="rounded-sb-sm bg-control-strong px-3 py-1 font-medium text-ink hover:bg-control-strong-hover"
      >
        Reset
      </button>
    </div>
  )
}
