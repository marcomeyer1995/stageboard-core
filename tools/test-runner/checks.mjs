// The checks of the device test runner (#819). Each takes the device context from run.mjs and
// records results; the page helpers they call live in page.js (window.__sbt).
import { appOf, sh } from '../lib/devices.mjs'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const toSec = (pos) => {
  const m = /^(\d+):(\d\d)$/.exec(pos ?? '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** The app is up: which build, which mode, the status bar there. */
async function app(ctx) {
  const version = (sh(ctx.device, `dumpsys package ${appOf(ctx.device)} | grep -m1 versionName`).split('=')[1] ?? '?').trim()
  const header = await ctx.eval('window.__sbt.header()')
  const ok = typeof header === 'string' && header.length > 0
  ctx.record({ check: 'app', name: 'running', status: ok ? 'pass' : 'fail', detail: `${version} · ${ok ? header.slice(0, 80) : 'no status bar'}` })
}

/**
 * Every main screen on this device's real size: nothing cut off, nothing past the edge, the page
 * never scrolling sideways (errors); touch targets and text sizes (warnings). A screenshot each.
 */
async function gui(ctx) {
  await scanScreens(ctx, '')
}

/** Every main screen as it is now: a result and a screenshot each, named with `size` in front. */
async function scanScreens(ctx, size) {
  const screens = [{ view: 'Boards' }, { view: 'Bibliothek' }]
  await ctx.eval("window.__sbt.view('System')")
  const tabs = (await ctx.eval('window.__sbt.systemTabs()')) ?? []
  for (const tab of tabs) screens.push({ view: 'System', tab })
  for (const s of screens) {
    const name = `${size ? `${size} · ` : ''}${s.tab ? `System › ${s.tab}` : s.view}`
    try {
      await scanOne(ctx, s, name, size)
    } catch (e) {
      // One screen that hangs (a slow device) fails alone, the others still run.
      ctx.record({ check: size ? 'gui-sizes' : 'gui', name, status: 'fail', detail: String(e.message ?? e) })
    }
  }
  await ctx.eval("window.__sbt.view('Boards')")
}

/** One screen: open it, scan it, a screenshot, a result. */
async function scanOne(ctx, s, name, size) {
  const ok = await ctx.eval(`window.__sbt.view(${JSON.stringify(s.view)})`)
  if (s.tab) {
    await ctx.eval(`window.__sbt.click(${JSON.stringify(s.tab)})`)
    await wait(1200)
  }
  if (!ok) {
    ctx.record({ check: size ? 'gui-sizes' : 'gui', name, status: 'skip', detail: 'could not open it' })
    return
  }
  const scan = await ctx.eval(`window.__sbt.gui(${JSON.stringify(s.view === 'Boards' ? 'stage' : 'prep')})`)
  const shot = await ctx.shot(`gui-${name}`)
  const problems = scan?.problems ?? []
  // 'note': cut on purpose (a title that scrolled through once) - in the report, never a failure.
  const errors = problems.filter((p) => p.severity === 'error')
  const warnings = problems.filter((p) => p.severity === 'warning')
  const list = (ps) => ps.slice(0, 6).map((p) => `${p.kind}: "${p.text}"${p.size ? ` ${p.size}` : ''}${p.px ? ` ${p.px}px` : ''}${p.needs ? ` (${p.width}/${p.needs}px)` : ''}${p.cut ? ` ${p.cut}px cut` : ''}`).join('; ')
  const status = errors.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass'
  const detail = `${scan?.viewport ?? ''} · ${errors.length} errors, ${warnings.length} warnings${errors.length ? ` · ${list(errors)}` : warnings.length ? ` · ${list(warnings)}` : ''}`
  ctx.record({ check: size ? 'gui-sizes' : 'gui', name, status, detail, shot, values: problems })
}

/**
 * Solo: start in the middle of a song (#817) - on the reference song ("Takt 35" at 1:13,
 * "Takt 5" at 0:10, section "Ritardando" at 0:34). Plays a few seconds; volume 0 at night.
 */
async function soloStart(ctx) {
  const before = (await ctx.eval('window.__sbt.header()')) ?? ''
  const wasGig = /\bGig\b/.test(before)
  await ctx.eval("window.__sbt.mode('Solo Üben')")
  await ctx.eval("window.__sbt.view('Boards')")
  ctx.quiet()
  await ctx.eval("window.__sbt.transport('stop')")
  await wait(1000)
  await ctx.eval("window.__sbt.openSong('StageBoard Referenz-Song')")
  await wait(800)
  const step = async (name, expr, expect, settle = 900) => {
    const done = await ctx.eval(expr)
    await wait(settle)
    const pos = await ctx.eval('window.__sbt.position()')
    const ok = done !== false && expect(toSec(pos))
    ctx.record({ check: 'solo-start', name, status: ok ? 'pass' : 'fail', detail: `position ${pos ?? '?'}` })
    return ok
  }
  if (!(await ctx.eval("window.__sbt.tapText('Takt 35')"))) {
    ctx.record({ check: 'solo-start', name: 'reference song open', status: 'skip', detail: 'no line "Takt 35" - open the StageBoard Referenz-Song' })
  } else {
    await wait(900)
    const pos = await ctx.eval('window.__sbt.position()')
    ctx.record({ check: 'solo-start', name: 'stopped, tap "Takt 35"', status: toSec(pos) === 73 ? 'pass' : 'fail', detail: `position ${pos ?? '?'} (want 1:13)` })
    await step('Play starts there', "window.__sbt.transport('play')", (s) => s !== null && s >= 75 && s <= 80, 4500)
    await step('playing, tap "Takt 5" jumps', "window.__sbt.tapText('Takt 5 ')", (s) => s !== null && s >= 10 && s <= 13, 1500)
    await ctx.eval("window.__sbt.transport('stop')")
    await wait(1000)
    await step('stopped, section "Ritardando"', "window.__sbt.click('Ritardando')", (s) => s === 34)
    await ctx.eval("window.__sbt.transport('stop')")
  }
  if (wasGig) await ctx.eval("window.__sbt.mode('Gig')")
}

/**
 * The sizes other devices have (#819 step 2), on this device: CDP makes its WebView lay out as a
 * phone or a tablet in either orientation - the very build in the APK, not the Stage-Server's.
 * Width × height in CSS px; `mobile` for touch layouts.
 */
export const SIZES = [
  { name: 'phone portrait', width: 375, height: 834, mobile: true },
  { name: 'phone landscape', width: 834, height: 375, mobile: true },
  { name: 'small phone', width: 360, height: 740, mobile: true },
  { name: 'tablet portrait', width: 800, height: 1280, mobile: true },
  { name: 'tablet landscape', width: 1280, height: 800, mobile: true },
  { name: 'laptop', width: 1440, height: 900, mobile: false },
]

/**
 * The reference device (devices.json `"sizes": "all"`, the Fire) checks every size; the others
 * their own size turned round - their own dashboards and font setting in the other orientation.
 * A phone pretending to be a laptop keeps its small font: no real case, only warnings.
 */
async function guiSizes(ctx) {
  let sizes = SIZES
  if (ctx.device.sizes !== 'all') {
    const own = await ctx.eval('[innerWidth, innerHeight]')
    const [w, h] = Array.isArray(own) ? own : [0, 0]
    sizes = [{ name: w > h ? 'own size, portrait' : 'own size, landscape', width: h, height: w, mobile: true }]
  }
  for (const size of sizes) {
    await ctx.cdp('Emulation.setDeviceMetricsOverride', {
      width: size.width,
      height: size.height,
      deviceScaleFactor: 0,
      mobile: size.mobile,
      screenOrientation: { type: size.width > size.height ? 'landscapePrimary' : 'portraitPrimary', angle: size.width > size.height ? 90 : 0 },
    })
    // Layout follows resize and media-query listeners; give them a moment.
    await wait(1500)
    const real = await ctx.eval('[innerWidth, innerHeight]')
    // A pixel or two off is rounding at a fractional device scale (the Redmi: 1006 × 602).
    if (!Array.isArray(real) || Math.abs(real[0] - size.width) > 2 || Math.abs(real[1] - size.height) > 2) {
      ctx.record({ check: 'gui-sizes', name: size.name, status: 'skip', detail: `the device did not take the size (${Array.isArray(real) ? real.join('×') : real})` })
      continue
    }
    await scanScreens(ctx, size.name)
  }
  await ctx.cdp('Emulation.clearDeviceMetricsOverride', {})
  await wait(1000)
}

export const CHECKS = { app: { run: app }, gui: { run: gui }, 'gui-sizes': { run: guiSizes }, 'solo-start': { run: soloStart } }
