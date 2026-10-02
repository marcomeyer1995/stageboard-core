import type { EventEmitter } from 'node:events'

/** How long a stop may take before the process exits anyway - well below systemd's
 * `TimeoutStopSec` (docs/03), so systemd never has to SIGKILL. */
export const SHUTDOWN_DEADLINE_MS = 10_000

export interface ShutdownOptions {
  /** `app.close()` - runs every `onClose` hook (MIDI watcher, plugins incl. the UG plugin's
   * Chrome, mDNS, ...). */
  close: () => Promise<void>
  log: {
    info: (msg: string, meta?: Record<string, unknown>) => void
    error: (msg: string, meta?: Record<string, unknown>) => void
  }
  exit: (code: number) => void
  deadlineMs?: number
}

/**
 * The Stage-Server's own SIGTERM/SIGINT handling (#335). Without it, Node's default "exit on
 * SIGTERM" was silently disabled as soon as Puppeteer (UG plugin) installed its own listener,
 * which only closed Chrome and never exited - every `systemctl restart` hung 90 s until
 * systemd SIGKILLed the process. A second signal while stopping exits at once.
 */
export function installShutdownHandlers(proc: Pick<EventEmitter, 'on'>, options: ShutdownOptions): void {
  const { close, log, exit, deadlineMs = SHUTDOWN_DEADLINE_MS } = options
  let stopping = false

  const onSignal = (signal: string) => {
    if (stopping) {
      log.error('Second stop signal while shutting down - exiting immediately', { signal })
      exit(1)
      return
    }
    stopping = true
    log.info('Stop signal received - shutting down', { signal })
    const deadline = setTimeout(() => {
      log.error('Shutdown did not finish in time - exiting anyway', { signal, deadlineMs })
      exit(1)
    }, deadlineMs)
    deadline.unref?.()
    close().then(
      () => {
        clearTimeout(deadline)
        log.info('Shut down cleanly', { signal })
        exit(0)
      },
      (err: unknown) => {
        clearTimeout(deadline)
        log.error('Error while shutting down', { signal, error: String(err) })
        exit(1)
      },
    )
  }

  proc.on('SIGTERM', () => onSignal('SIGTERM'))
  proc.on('SIGINT', () => onSignal('SIGINT'))
}

/**
 * Remembers every open TLS connection of the server so a stop can drop them. Each tablet keeps
 * several SSE streams open that never end on their own, and the HTTP/2 server's `close()` waits
 * for open streams - so without this, `app.close()` would wait until the deadline. Tablets
 * reconnect on their own once the server is back.
 */
export function trackConnections(server: Pick<EventEmitter, 'on'>): () => void {
  const sockets = new Set<{ destroy: () => void } & Pick<EventEmitter, 'once'>>()
  server.on('secureConnection', (socket: { destroy: () => void } & Pick<EventEmitter, 'once'>) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  return () => {
    for (const socket of sockets) socket.destroy()
    sockets.clear()
  }
}
