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
