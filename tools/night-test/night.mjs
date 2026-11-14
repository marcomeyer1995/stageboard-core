#!/usr/bin/env node
// Night test, locked screen (#724, #789) - see README.md:
//   node night.mjs unlock    wake + dismiss the lock screen (devices without PIN)
//   node night.mjs prepare   ports, counters, media volume to 0 - devices unlocked, a song loaded in Solo Üben
//   node night.mjs start     Play + loop the section on each device, check clicks run, then lock - t0
//   node night.mjs run       probes at 3/6/10/15/20/30/45/60/90/120/180/240/300/360 min after t0 (runs for hours)
//   node night.mjs probe     one probe of each device now, nothing written
//   node night.mjs report    table of all probes -> out/report.md
// Devices: tools/devices.json (all of them, or NIGHT_DEVICES=Fire,Redmi). Only reads, Play/loop,
// lock and (no PIN) unlock - never touches settings.
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appOf, forwardApp as forward, pickDevices, setVolume, sh } from '../lib/devices.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const DEVICES = pickDevices(process.env.NIGHT_DEVICES ? process.env.NIGHT_DEVICES.split(',') : [])
const CHECKPOINTS_MIN = [3, 6, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 360]
const OUT = join(here, 'out')
mkdirSync(OUT, { recursive: true })
const RESULTS = join(OUT, 'results.jsonl')
const STATE = join(OUT, 'state.json')

function cdp(d, expr, timeoutMs = 90000) {
  try {
    const out = execFileSync('node', [join(here, '..', 'cdp', 'cdp.mjs'), 'eval', String(d.port), expr, String(timeoutMs)], { encoding: 'utf8', timeout: timeoutMs + 10000 }).trim()
    return JSON.parse(out)
  } catch (e) {
    const out = e.stdout?.toString().trim()
    try {
      return JSON.parse(out)
    } catch {
      return { error: `cdp: ${(out || e.message).split('\n')[0]}` }
    }
  }
}

/** What Android says: screen, app alive, foreground service, the app's audio players. */
function androidSide(d, pid) {
  const power = sh(d, 'dumpsys power')
  const wake = power.match(/mWakefulness=(\w+)/)?.[1]
  const nowPid = sh(d, `pidof ${appOf(d)}`)
  const fgs = /isForeground=true/.test(sh(d, `dumpsys activity services ${appOf(d)}`))
  const players = sh(d, 'dumpsys audio')
    .split('\n')
    .filter((l) => l.includes('AudioPlaybackConfiguration') && l.includes(`/${nowPid} `))
    .map((l) => `${l.match(/type:(\S+)/)?.[1]}:${l.match(/state:(\S+)/)?.[1]}`)
  // Android 9 (the Fire) lists no players there - AudioFlinger's track table does: A = active.
  if (players.length === 0) {
    const re = new RegExp(`^\\s+\\d+\\s+(?:yes|no)\\s+${nowPid}\\s+\\d+\\s+(\\w)\\s`, 'gm')
    for (const m of sh(d, 'dumpsys media.audio_flinger').matchAll(re)) players.push(`track:${m[1]}`)
  }
  return { wake, appAlive: nowPid === pid, pid: nowPid, fgs, players }
}

/** Media volume to 0 (night) and read back. */
const silence = (d) => setVolume(d, 0)

const cmd = process.argv[2]

if (cmd === 'prepare') {
  const state = { devices: {} }
  for (const d of DEVICES) {
    const f = forward(d)
    const volume = silence(d)
    const installed = f.error ? null : cdp(d, readFileSync(join(here, 'install.js'), 'utf8'))
    state.devices[d.name] = { ...f, volume, installed }
    console.log(d.name, JSON.stringify(state.devices[d.name]))
  }
  writeFileSync(STATE, JSON.stringify(state, null, 1))
} else if (cmd === 'start') {
  const state = JSON.parse(readFileSync(STATE, 'utf8'))
  for (const d of DEVICES) {
    const s = state.devices[d.name]
    // Right before playing: the volume again (it came back after reconnects before).
    s.volumeAtStart = silence(d)
    if (s.volumeAtStart !== '0') {
      console.log(d.name, 'volume not 0 - not starting:', s.volumeAtStart)
      continue
    }
    s.play = cdp(d, "window.__sbRunAction({ kind: 'show', op: 'play-pause' })")
  }
  // The loop takes the section playing - not yet during the count-in before the first part.
  execFileSync('sleep', ['6'])
  for (const d of DEVICES) {
    const s = state.devices[d.name]
    if (s.play === undefined) continue
    s.loop = cdp(d, "window.__sbRunAction({ kind: 'section', op: 'loop-on' })")
    console.log(d.name, 'play', JSON.stringify(s.play), 'loop', JSON.stringify(s.loop))
    if (s.loop !== null) console.log(d.name, '!! no loop - the song needs named parts ({part: ...}) with timed lines; it ends after one pass')
  }
  // Clicks must run before locking - else the test measures nothing.
  execFileSync('sleep', ['8'])
  for (const d of DEVICES) {
    const s = state.devices[d.name]
    const r = cdp(d, readFileSync(join(here, 'read.js'), 'utf8'))
    s.check = r
    console.log(d.name, 'before lock:', r.clicks, 'clicks in', r.sinceS, 's, period', r.clickPeriodMs, 'ms')
    if (!(r.clicks > 0)) console.log(d.name, '!! no clicks - is a song with click loaded and playing?')
    sh(d, 'input keyevent KEYCODE_SLEEP')
    s.lockedAt = Date.now()
  }
  state.t0 = Date.now()
  writeFileSync(STATE, JSON.stringify(state, null, 1))
  console.log('locked at', new Date(state.t0).toLocaleTimeString())
} else if (cmd === 'unlock') {
  // No PIN on the test devices any more (Marco, 2026-11-10): wake up and take the lock screen away.
  for (const d of DEVICES) {
    sh(d, 'input keyevent KEYCODE_WAKEUP')
    sh(d, 'wm dismiss-keyguard')
    console.log(d.name, sh(d, 'dumpsys power').match(/mWakefulness=(\w+)/)?.[1])
  }
} else if (cmd === 'probe') {
  // One probe of each device now (not written to the results).
  for (const d of DEVICES) {
    const f = forward(d)
    const android = f.error ? f : androidSide(d, f.pid)
    const page = f.error ? null : cdp(d, readFileSync(join(here, 'read.js'), 'utf8'))
    console.log(d.name, JSON.stringify({ android, page }))
  }
} else if (cmd === 'run') {
  const state = JSON.parse(readFileSync(STATE, 'utf8'))
  for (const min of CHECKPOINTS_MIN) {
    const due = state.t0 + min * 60000
    while (Date.now() < due) execFileSync('sleep', [String(Math.min(30, Math.ceil((due - Date.now()) / 1000)))])
    for (const d of DEVICES) {
      const s = state.devices[d.name]
      const android = androidSide(d, s.pid)
      const page = android.appAlive ? cdp(d, readFileSync(join(here, 'read.js'), 'utf8')) : { error: 'app gone' }
      const line = { device: d.name, checkpointMin: min, at: new Date().toISOString(), android, page }
      appendFileSync(RESULTS, JSON.stringify(line) + '\n')
      console.log(JSON.stringify(line))
    }
  }
} else if (cmd === 'report') {
  if (!existsSync(RESULTS)) throw new Error('no results yet')
  const rows = readFileSync(RESULTS, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const cell = (v) => (v === undefined || v === null ? '–' : typeof v === 'object' ? JSON.stringify(v) : String(v))
  let md = '| Device | min | Screen | App/service | Audio | Timer (ticks/expected, largest gap) | Clicks (missing, largest gap) | Plugin answer |\n|---|---|---|---|---|---|---|---|\n'
  for (const r of rows) {
    const p = r.page
    md += `| ${r.device} | ${r.checkpointMin} | ${cell(r.android.wake)} | ${r.android.appAlive ? 'running' : 'gone'}${r.android.fgs ? ' + service' : ''} | ${cell(r.android.players.join(' '))} | ${p.error ? p.error : `${p.timerTicks}/${p.timerExpected}, ${p.timerMaxGapS} s`} | ${p.error ? '–' : `${p.clicks} (${p.missingClicks}, ${p.worstClickGapS} s)`} | ${p.error ? '–' : cell(p.pluginMs)} |\n`
  }
  writeFileSync(join(OUT, 'report.md'), md)
  console.log(md)
} else {
  console.log('usage: node night.mjs unlock|prepare|start|run|probe|report')
}
