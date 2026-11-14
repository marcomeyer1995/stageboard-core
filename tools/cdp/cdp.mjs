#!/usr/bin/env node
// Talk to a page over the DevTools Protocol - the app on a device (by name from devices.json,
// forwarded over adb) or any CDP port (a headless Chrome, see tools/phone-check).
//
//   node tools/cdp/cdp.mjs eval <device|port> "<expression>" [timeoutMs]   value as JSON
//   node tools/cdp/cdp.mjs nav <device|port> <url>                         navigate, wait 3 s
//   node tools/cdp/cdp.mjs shot <device|port> <out.png> [width height]     screenshot
//
// CDP_VIEWPORT=390x844x3 sets a phone viewport with touch for this call (headless Chrome keeps
// windows at least 500 px wide, and an emulation ends with the DevTools session - so it is set
// on every call). A device name forwards its app's WebView first (the app must be running, the dev app or the
// one set as "app" in devices.json; release builds are not debuggable).
import { writeFileSync } from 'node:fs'
import { connectPage, evaluate, within } from '../lib/cdp.mjs'
import { forwardApp, pickDevices } from '../lib/devices.mjs'

const [cmd, target, ...rest] = process.argv.slice(2)
if (!cmd || !target) {
  console.log('usage: cdp.mjs eval|nav|shot <device|port> ...')
  process.exit(2)
}

let port = Number(target)
if (!Number.isInteger(port) || port <= 0) {
  const [d] = pickDevices([target])
  const f = forwardApp(d)
  if (f.error) {
    console.log(JSON.stringify(f))
    process.exit(1)
  }
  port = d.port
}

const page = await connectPage(port)
if (process.env.CDP_VIEWPORT) {
  const [w, h, dpr = 1] = process.env.CDP_VIEWPORT.split('x').map(Number)
  await page.call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: true })
  await page.call('Emulation.setTouchEmulationEnabled', { enabled: true })
}
try {
  if (cmd === 'eval') {
    const [expr, timeout = '60000'] = rest
    console.log(JSON.stringify(await within(Number(timeout), evaluate(page, expr)), null, 1))
  } else if (cmd === 'nav') {
    await page.call('Page.navigate', { url: rest[0] })
    await new Promise((r) => setTimeout(r, 3000))
  } else if (cmd === 'shot') {
    const [out, w, h] = rest
    if (w) await page.call('Emulation.setDeviceMetricsOverride', { width: Number(w), height: Number(h), deviceScaleFactor: 1, mobile: false })
    await new Promise((r) => setTimeout(r, 500))
    const r = await page.call('Page.captureScreenshot', { format: 'png' })
    writeFileSync(out, Buffer.from(r.data, 'base64'))
    console.log(out)
  } else {
    console.log(`unknown command ${cmd}`)
    process.exitCode = 2
  }
} catch (e) {
  console.log(JSON.stringify({ error: e.message }))
  process.exitCode = 1
} finally {
  page.close()
}
process.exit()
