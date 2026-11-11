#!/usr/bin/env node
// Everyday adb chores on the test devices (tools/devices.json). Never touches system settings.
//
//   node tools/device/device.mjs info [device...]              model, Android, app versions, screen, volume
//   node tools/device/device.mjs install <apk> [device...]      adb install -r (keeps the app's data)
//   node tools/device/device.mjs volume <0-15> [device...]      media volume, read back
//   node tools/device/device.mjs wake [device...]               wake and dismiss the lock screen (no PIN only)
//
// No device names: all devices in devices.json.
import { existsSync } from 'node:fs'
import { DEV_APP, adb, pickDevices, readVolume, readVolumeRange, setVolume, sh } from '../lib/devices.mjs'

const [cmd, ...args] = process.argv.slice(2)

const appVersion = (d, pkg) => sh(d, `dumpsys package ${pkg}`).match(/versionName=(\S+)/)?.[1] ?? '-'

if (cmd === 'info') {
  for (const d of pickDevices(args)) {
    const model = sh(d, 'getprop ro.product.model')
    const android = sh(d, 'getprop ro.build.version.release')
    const wake = sh(d, 'dumpsys power').match(/mWakefulness=(\w+)/)?.[1]
    console.log(`${d.name}: ${model}, Android ${android}, screen ${wake}, volume ${(({ level, max }) => (max === null ? level : `${level}/${max}`))(readVolumeRange(d))}, dev app ${appVersion(d, DEV_APP)}, release app ${appVersion(d, 'de.stageboard.app')}`)
  }
} else if (cmd === 'install') {
  const [apk, ...names] = args
  if (!apk || !existsSync(apk)) {
    console.error(`APK not found: ${apk}`)
    process.exit(2)
  }
  for (const d of pickDevices(names)) {
    // Xiaomi devices wait for an OK on the screen during the install.
    console.log(`${d.name}: installing ${apk} ...`)
    console.log(`${d.name}: ${adb(d, 'install', '-r', apk).split('\n').pop()}`)
    // Some devices bring their speaker volume back up after an install - say so.
    console.log(`${d.name}: volume now ${readVolume(d)}`)
  }
} else if (cmd === 'volume') {
  const [level, ...names] = args
  const n = Number(level)
  if (!Number.isInteger(n) || n < 0) {
    console.error('volume: a step of the device\'s own scale, 0 = silent (see info for the scale)')
    process.exit(2)
  }
  for (const d of pickDevices(names)) {
    const { max } = readVolumeRange(d)
    console.log(`${d.name}: volume ${setVolume(d, max === null ? n : Math.min(n, max))}${max === null ? '' : `/${max}`}`)
  }
} else if (cmd === 'wake') {
  for (const d of pickDevices(args)) {
    sh(d, 'input keyevent KEYCODE_WAKEUP')
    sh(d, 'wm dismiss-keyguard')
    console.log(`${d.name}: ${sh(d, 'dumpsys power').match(/mWakefulness=(\w+)/)?.[1]} (a PIN still has to be typed on the device)`)
  }
} else {
  console.log('usage: device.mjs info|install|volume|wake ...')
  process.exit(2)
}
