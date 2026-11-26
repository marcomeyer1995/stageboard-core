#!/usr/bin/env node
/**
 * Does the page's JavaScript keep running while the screen is off? (the tablet host's lease timer lives there - docs/25 "Screen locked")
 *
 *   STAGEBOARD_DEV_APP=de.stageboard.app.dev.test node tools/host-test/screen-off.mjs <Device> [seconds=480] [hostUrl]
 *
 * Puts a 1 s timer on the page's main thread and one in a Worker, switches the screen off with the power key (no setting changes), waits, wakes it and
 * reports how many ticks came, the longest gap, and - with `hostUrl` - whether the native server kept answering `/time` meanwhile. A timer that stopped shows
 * as few ticks for the time passed, not necessarily as one long gap: read `ticks` against `seconds`. Nothing is typed. Night rule: it asks for no sound.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const [device, secs = '480', hostUrl] = process.argv.slice(2)
if (!device) {
  console.error('usage: screen-off.mjs <Device> [seconds] [hostUrl]')
  process.exit(2)
}
const devices = JSON.parse(readFileSync(join(here, '..', 'devices.json'), 'utf8'))
const entry = devices.find((d) => d.name === device)
const adbModel = entry?.model
const serial = execFileSync('adb', ['devices', '-l'], { encoding: 'utf8' }).split('\n').find((l) => adbModel && l.includes(`model:${adbModel}`))?.split(/\s+/)[0] ?? entry?.serial
if (!serial) throw new Error(`no adb serial for ${device}`)
const adb = (...a) => execFileSync('adb', ['-s', serial, ...a], { encoding: 'utf8' }).trim()
const cdp = (expr) => execFileSync('node', [join(here, '..', 'cdp', 'cdp.mjs'), 'eval', device, expr], { encoding: 'utf8', env: process.env, timeout: 60000 }).trim().split('\n').pop()
const seconds = Number(secs)

adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
await new Promise((r) => setTimeout(r, 1500))
console.log('injected:', cdp("(()=>{window.__t1=[];window.__t2=[];setInterval(()=>window.__t1.push(Date.now()),1000);const w=new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(Date.now()),1000)'],{type:'text/javascript'})));w.onmessage=e=>window.__t2.push(e.data);return document.visibilityState})()"))
await new Promise((r) => setTimeout(r, 3000))
adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP')
const start = Date.now()
let ok = 0
let fail = 0
let slowest = 0
let bandOk = 0
let bandFail = 0
while (Date.now() - start < seconds * 1000) {
  if (hostUrl) {
    const t0 = Date.now()
    try {
      const r = await fetch(`${hostUrl}/time`, { signal: AbortSignal.timeout(4000) })
      if (r.ok) ok += 1
      else fail += 1
    } catch {
      fail += 1
    }
    slowest = Math.max(slowest, Date.now() - t0)
    // `/time` is answered by the native server itself; `/workspaces` needs the page's JavaScript (the host's code) - the one that says whether the band is served.
    try {
      const r = await fetch(`${hostUrl}/workspaces`, { signal: AbortSignal.timeout(4000) })
      if (r.ok) bandOk += 1
      else bandFail += 1
    } catch {
      bandFail += 1
    }
  }
  await new Promise((r) => setTimeout(r, 3000))
}
const wake = adb('shell', 'dumpsys', 'power').match(/mWakefulness=(\w+)/)?.[1]
adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
await new Promise((r) => setTimeout(r, 3000))
const result = JSON.parse(JSON.parse(cdp("(()=>{const gaps=a=>{const g=[];for(let i=1;i<a.length;i++)g.push(a[i]-a[i-1]);return {ticks:a.length,maxGapMs:g.length?Math.max(...g):null,over3s:g.filter(x=>x>3000).length}};return JSON.stringify({main:gaps(window.__t1),worker:gaps(window.__t2)})})()")))
console.log(`screen was ${wake} for ${seconds} s`)
console.log(`main thread timer: ${result.main.ticks} ticks (a steady timer gives about ${seconds}), longest gap ${result.main.maxGapMs} ms`)
console.log(`worker timer:      ${result.worker.ticks} ticks, longest gap ${result.worker.maxGapMs} ms`)
if (hostUrl) {
  console.log(`native /time: ${ok} answered, ${fail} failed, slowest ${slowest} ms`)
  console.log(`band routes (/workspaces, need the page): ${bandOk} answered, ${bandFail} failed`)
}
const steady = result.main.ticks >= seconds * 0.9
console.log(steady ? 'RUNS: the page kept running with the screen off' : 'STOPS: the page did not keep running with the screen off')
process.exit(steady ? 0 : 1)
