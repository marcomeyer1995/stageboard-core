// The test devices, from tools/devices.json (git-ignored: serials stay out of the repo, #786).
// See tools/devices.example.json for the shape.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const DEVICES_FILE = process.env.SB_DEVICES ?? join(here, '..', 'devices.json')

/**
 * @typedef {{ name: string, serial: string, port: number, volume?: 'media' | 'keys' | 'session', app?: string, model?: string }} Device
 * `port`: the local port the app's DevTools socket is forwarded to. `volume`: how media volume
 * really changes on that device (see tools/device/README.md). `app`: the package (default: the
 * dev app). `model`: the adb model (`adb devices -l`, e.g. 24075RP89G) - with it the device is
 * found whatever its serial is now: wireless adb ports change on every restart.
 */

/** @returns {Device[]} */
export function loadDevices() {
  if (!existsSync(DEVICES_FILE)) {
    console.error(`No ${DEVICES_FILE} - copy tools/devices.example.json to tools/devices.json and fill in your serials (adb devices -l).`)
    process.exit(2)
  }
  return JSON.parse(readFileSync(DEVICES_FILE, 'utf8'))
}

/** Devices by name (case-insensitive), or all when no names are given. */
export function pickDevices(names) {
  const all = loadDevices()
  if (names.length === 0) return all
  return names.map((n) => {
    const d = all.find((x) => x.name.toLowerCase() === n.toLowerCase())
    if (!d) {
      console.error(`Unknown device "${n}" - known: ${all.map((x) => x.name).join(', ')}`)
      process.exit(2)
    }
    return d
  })
}

export const DEV_APP = 'de.stageboard.app.dev'
export const appOf = (d) => d.app ?? DEV_APP

export function adb(d, ...args) {
  try {
    return execFileSync('adb', ['-s', d.serial, ...args], { encoding: 'utf8', timeout: 120000 }).trim()
  } catch (e) {
    return `error: ${(e.stderr?.toString() || e.message).split('\n')[0]}`
  }
}
export const sh = (d, cmd) => adb(d, 'shell', cmd)

/** Forwards the app's WebView DevTools socket to `d.port` (the app must be running). */
export function forwardApp(d) {
  const pid = sh(d, `pidof ${appOf(d)}`)
  if (!/^\d+$/.test(pid)) return { error: `${appOf(d)} not running on ${d.name}` }
  adb(d, 'forward', `tcp:${d.port}`, `localabstract:webview_devtools_remote_${pid}`)
  return { pid }
}

/** The media volume as Android reports it (stream 3) - each device has its own scale. */
export function readVolumeRange(d) {
  const out = d.volume === 'media' ? sh(d, 'media volume --stream 3 --get') : sh(d, 'cmd media_session volume --stream 3 --get')
  const m = out.match(/volume is (\d+) in range \[(\d+)\.\.(\d+)\]/)
  return m ? { level: m[1], max: Number(m[3]) } : { level: out, max: null }
}
export const readVolume = (d) => readVolumeRange(d).level

/**
 * Sets the media volume the way that really works on the device (devices.json `volume`):
 * - media:   `media volume --set` (older Android, the Fire)
 * - session: `cmd media_session volume --set` (works on the Xiaomi phone, which blocks key events)
 * - keys:    volume keys down to 0 and up again (the Redmi says --set worked and does nothing)
 */
export function setVolume(d, level) {
  if (d.volume === 'media') sh(d, `media volume --stream 3 --set ${level}`)
  else if (d.volume === 'session') sh(d, `cmd media_session volume --stream 3 --set ${level}`)
  else {
    for (let i = 0; i < 30; i++) sh(d, 'input keyevent KEYCODE_VOLUME_DOWN')
    for (let i = 0; i < level; i++) sh(d, 'input keyevent KEYCODE_VOLUME_UP')
  }
  return readVolume(d)
}

/** The serials adb sees right now with their model (`adb devices -l`). */
export function attached() {
  let out = ''
  try {
    out = execFileSync('adb', ['devices', '-l'], { encoding: 'utf8', timeout: 20000 })
  } catch {
    return []
  }
  return out
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols[1] === 'device')
    .map((cols) => ({ serial: cols[0], model: (cols.find((c) => c.startsWith('model:')) ?? '').slice(6) }))
}

/**
 * The device with the serial it has now: its own serial when adb sees it, else the attached one
 * with its `model` (a USB serial first, then wireless). Null when it is not there.
 */
export function resolveDevice(d, seen = attached()) {
  if (seen.some((a) => a.serial === d.serial)) return d
  if (!d.model) return null
  const same = seen.filter((a) => a.model === d.model)
  const pick = same.find((a) => !a.serial.includes(':')) ?? same[0]
  return pick ? { ...d, serial: pick.serial } : null
}
