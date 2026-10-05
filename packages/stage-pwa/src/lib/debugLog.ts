import { create } from 'zustand'

/**
 * In-app log for the Live-Debug-Console (#14): the last entries of everything the app writes to
 * the browser console, plus uncaught errors - readable on the tablet itself (System → Diagnose),
 * without a USB cable, adb or devtools. In memory only; a reload starts empty.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  id: number
  /** Date.now() */
  at: number
  level: LogLevel
  text: string
}

export const LOG_CAPACITY = 500

interface DebugLogState {
  entries: LogEntry[]
  add: (level: LogLevel, text: string) => void
  clear: () => void
}

let nextId = 1

export const useDebugLogStore = create<DebugLogState>((set) => ({
  entries: [],
  add: (level, text) =>
    set((state) => {
      const entries = [...state.entries, { id: nextId++, at: Date.now(), level, text }]
      return { entries: entries.length > LOG_CAPACITY ? entries.slice(entries.length - LOG_CAPACITY) : entries }
    }),
  clear: () => set({ entries: [] }),
}))

/** One console argument as readable text (objects as JSON, errors with their stack's first line). */
export function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`
  try {
    const json = JSON.stringify(arg)
    return json === undefined ? String(arg) : json.length > 500 ? `${json.slice(0, 500)}…` : json
  } catch {
    return String(arg)
  }
}

let installed = false

/**
 * Mirrors console.log/info/warn/error and uncaught errors into the log store. Idempotent; the
 * original console output stays unchanged (devtools keep working as before).
 */
export function installConsoleCapture(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const levels: Array<[keyof Console, LogLevel]> = [
    ['log', 'debug'],
    ['info', 'info'],
    ['warn', 'warn'],
    ['error', 'error'],
  ]
  for (const [method, level] of levels) {
    const original = console[method] as (...args: unknown[]) => void
    ;(console as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
      original.apply(console, args)
      try {
        useDebugLogStore.getState().add(level, args.map(formatArg).join(' '))
      } catch {
        // Logging must never break the app.
      }
    }
  }
  window.addEventListener('error', (event) => {
    useDebugLogStore.getState().add('error', `Uncaught ${event.message}${event.filename ? ` (${event.filename}:${event.lineno})` : ''}`)
  })
  window.addEventListener('unhandledrejection', (event) => {
    useDebugLogStore.getState().add('error', `Unhandled rejection: ${formatArg(event.reason)}`)
  })
}

/** Detail logging switched on per area - read by gridDebug/configDebug/clockSyncDebug on every
 * call, so a switch takes effect at once (no reload). */
export const DEBUG_FLAGS = [
  { key: 'sb:debug:grid', label: 'Dashboard-Raster (Ziehen, Größe ändern)' },
  { key: 'sb:debug:config', label: 'Speichern & Konflikte' },
  { key: 'sb:debug:clocksync', label: 'Uhr-Synchronisation' },
] as const

export function debugFlagOn(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

export function setDebugFlag(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, '1')
    else localStorage.removeItem(key)
  } catch {
    // Private mode etc. - nothing to persist.
  }
}

/** All entries as plain text, oldest first - for "Kopieren". */
export function entriesAsText(entries: readonly LogEntry[]): string {
  return entries.map((e) => `${new Date(e.at).toISOString().slice(11, 23)} ${e.level.toUpperCase().padEnd(5)} ${e.text}`).join('\n')
}
