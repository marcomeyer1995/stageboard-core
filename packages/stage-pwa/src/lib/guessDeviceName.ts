/**
 * Best-effort default name for a device's first DeviceRegistry entry (#10) - always
 * renameable afterward (DeviceNameSettings.tsx), this just saves someone from staring at a
 * raw device id the very first time they open the app. Deliberately coarse (device class, not
 * model/browser detail): good enough to tell tablets apart on a "Wer war das?" glance, not a
 * user-agent-sniffing exercise.
 */
export function guessDeviceName(): string {
  const ua = navigator.userAgent
  if (/iPad/.test(ua)) return 'iPad'
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android-Telefon' : 'Android-Tablet'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows-PC'
  if (/Linux/.test(ua)) return 'Linux-PC'
  return 'Unbekanntes Gerät'
}

/** The dev app (docs/03 §0c) is a device of its own beside the release app on the same tablet. */
const IS_DEV_APP = import.meta.env.VITE_DEV_APP === '1'

/**
 * The name a device gets when it first joins a band: the guess, "Dev" for the dev app, and a
 * number when the band already has a device by that name (Marco, 2026-10-17: the dev apps on the
 * Xiaomi and the Fire both came in as "Android-Tablet" - indistinguishable in "spielt auf").
 * Best effort: a device not yet synced from the server isn't seen.
 */
export function firstDeviceName(takenNames: readonly string[], devApp = IS_DEV_APP): string {
  const base = devApp ? `${guessDeviceName()} Dev` : guessDeviceName()
  const taken = new Set(takenNames.map((name) => name.trim().toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`
}
