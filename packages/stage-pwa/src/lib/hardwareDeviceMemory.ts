const STORAGE_KEY = 'stageboard-hardware-memory'

/**
 * "Auto-Memory" (#106): once a physical device has been assigned to a Logical Device role on
 * this tablet, remember it locally so reconnecting never re-prompts. Deliberately plain
 * `localStorage`, not a workspace-replicated PouchDB doc - a physical port/device is a fact
 * about *this tablet*, not something other tablets should inherit (same reasoning as
 * deviceId.ts). Keyed by shared-types' hardwareMatching.ts's `hardwareKeyFor(detected)`.
 */
function readMemory(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function getRememberedLogicalDeviceId(hardwareKey: string): string | null {
  return readMemory()[hardwareKey] ?? null
}

export function rememberLogicalDeviceId(hardwareKey: string, logicalDeviceId: string): void {
  try {
    const memory = readMemory()
    memory[hardwareKey] = logicalDeviceId
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory))
  } catch {
    // Private mode / blocked storage: the assignment still applies for this session, it just
    // won't be remembered next time - same graceful-degradation spirit as useThemeStore.ts.
  }
}
