const STORAGE_KEY = 'stageboard-device-name'

/**
 * This device's own name, kept on the device too (Marco, 2026-10-08). The name set under
 * Einstellungen → Gerätename lives in the band's device entry - and "Aus Liste entfernen" /
 * "Inaktive entfernen" delete exactly that entry. Without a copy here the device came back under a
 * guessed name ("Android-Tablet") the next time it started.
 */
export function rememberedDeviceName(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)?.trim() || null
  } catch {
    return null
  }
}

export function rememberDeviceName(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, name)
  } catch {
    // Storage blocked: the band's entry still has the name, it just can't come back after removal.
  }
}
