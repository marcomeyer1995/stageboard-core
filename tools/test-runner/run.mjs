// The device test runner (#819): runs checks against the app on the real test devices over CDP
// and writes a report - what was checked, with values and screenshots - for the acceptance.
//
//   node tools/test-runner/run.mjs [--devices Fire,Phone] [--checks app,gui,solo-start] [--out dir]
//
// Devices come from tools/devices.json and are found by their adb model when their serial moved
// (wireless adb). The dev app must be installed; a stopped app is started. Nothing is typed, no
// system setting is changed; at night (22-8 h) the volume is set to 0 before anything plays.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectPage, evaluate, within } from '../lib/cdp.mjs'
import { appOf, attached, forwardApp, pickDevices, resolveDevice, setVolume, sh } from '../lib/devices.mjs'
import { CHECKS } from './checks.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const deviceNames = (opt('devices') ?? '').split(',').filter(Boolean)
const checkIds = (opt('checks') ?? Object.keys(CHECKS).join(',')).split(',').filter(Boolean)
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = opt('out') ?? join(here, 'out', stamp)
mkdirSync(outDir, { recursive: true })
const PAGE_JS = readFileSync(join(here, 'page.js'), 'utf8')
const night = () => {
  const h = new Date().getHours()
  return h >= 22 || h < 8
}

/** @type {{ check: string, device: string, name: string, status: 'pass'|'fail'|'warn'|'skip', detail?: string, shot?: string, values?: unknown }[]} */
const results = []
const record = (r) => {
  results.push(r)
  console.log(`${r.status.toUpperCase().padEnd(4)} ${r.device} · ${r.check} · ${r.name}${r.detail ? ` - ${r.detail}` : ''}`)
}

async function startApp(d) {
  let fwd = forwardApp(d)
  if (!fwd.error) return fwd
  sh(d, `monkey -p ${appOf(d)} -c android.intent.category.LAUNCHER 1`)
  for (let i = 0; i < 20 && fwd.error; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    fwd = forwardApp(d)
  }
  return fwd
}

const seen = attached()
for (const wanted of pickDevices(deviceNames)) {
  const d = resolveDevice(wanted, seen)
  if (!d) {
    record({ check: 'device', device: wanted.name, name: 'reachable', status: 'skip', detail: 'not attached (adb devices) - off, asleep or off the network' })
    continue
  }
  const fwd = await startApp(d)
  if (fwd.error) {
    record({ check: 'device', device: d.name, name: 'app', status: 'fail', detail: fwd.error })
    continue
  }
  // A freshly started app needs a moment for its first page.
  await new Promise((r) => setTimeout(r, 1500))
  let page
  try {
    page = await within(15000, connectPage(d.port))
  } catch (e) {
    record({ check: 'device', device: d.name, name: 'devtools', status: 'fail', detail: String(e.message ?? e) })
    continue
  }
  await evaluate(page, PAGE_JS)
  const ctx = {
    device: d,
    outDir,
    eval: (expr) => within(45000, evaluate(page, expr)),
    shot: async (name) => {
      const r = await within(60000, page.call('Page.captureScreenshot', { format: 'png' }))
      const file = `${d.name}-${name}.png`.replace(/[^\w.-]+/g, '_')
      writeFileSync(join(outDir, file), Buffer.from(r.data, 'base64'))
      return file
    },
    quiet: () => (night() ? setVolume(d, 0) : null),
    /** A raw DevTools call on the page (Emulation, Page, …). */
    cdp: (method, params) => within(20000, page.call(method, params)),
    record: (r) => record({ device: d.name, ...r }),
  }
  for (const id of checkIds) {
    const check = CHECKS[id]
    if (!check) {
      record({ check: id, device: d.name, name: 'unknown check', status: 'skip' })
      continue
    }
    try {
      await check.run(ctx)
    } catch (e) {
      record({ check: id, device: d.name, name: 'crashed', status: 'fail', detail: String(e.message ?? e) })
    }
  }
  page.close()
}

// The report: a summary per device and check, then every finding with its screenshot.
const count = (s) => results.filter((r) => r.status === s).length
const lines = [
  `# Device test ${stamp}`,
  '',
  `pass ${count('pass')} · fail ${count('fail')} · warn ${count('warn')} · skip ${count('skip')}`,
  '',
  '| Device | Check | What | Result | Detail |',
  '|---|---|---|---|---|',
  ...results.map((r) => `| ${r.device} | ${r.check} | ${r.name} | ${r.status} | ${(r.detail ?? '').replace(/\|/g, '/')}${r.shot ? ` ![](${r.shot})` : ''} |`),
  '',
]
writeFileSync(join(outDir, 'report.md'), lines.join('\n'))
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ stamp, results }, null, 2))
console.log(`\nreport: ${join(outDir, 'report.md')}`)
process.exit(count('fail') > 0 ? 1 : 0)
