#!/usr/bin/env node
// A page at phone size in a headless Chrome on the laptop - for layout checks without a phone.
//
//   node tools/phone-check/phone-check.mjs start [port]       headless Chrome, DevTools on port (9400)
//   node tools/phone-check/phone-check.mjs open <url> [port]   navigate
//   node tools/phone-check/phone-check.mjs stop [port]         close that Chrome
// The phone size comes with each cdp.mjs call: CDP_VIEWPORT=390x844x3 node tools/cdp/cdp.mjs shot 9400 out.png
// (headless Chrome keeps windows at least 500 px wide, and an emulation ends with its session).
//
// Then: node tools/cdp/cdp.mjs shot <port> out.png / eval <port> "<expr>".
// Its profile lives in tools/phone-check/out/profile (git-ignored), never your own.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectPage } from '../lib/cdp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const [cmd, ...args] = process.argv.slice(2)
const CHROME = process.env.CHROME ?? 'google-chrome'

if (cmd === 'start') {
  const port = Number(args[0] ?? 9400)
  const profile = join(here, 'out', 'profile')
  mkdirSync(profile, { recursive: true })
  // A self-signed Stage-Server certificate is fine here: this Chrome only ever looks at test pages.
  const child = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--ignore-certificate-errors', 'about:blank'], { detached: true, stdio: 'ignore' })
  child.unref()
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`)
      console.log(`Chrome on DevTools port ${port}`)
      process.exit(0)
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  console.error('Chrome did not come up')
  process.exit(1)
} else if (cmd === 'open') {
  const [url, port = '9400'] = args
  const page = await connectPage(Number(port))
  await page.call('Page.navigate', { url })
  await new Promise((r) => setTimeout(r, 3000))
  page.close()
  console.log(url)
  process.exit(0)
} else if (cmd === 'stop') {
  const port = Number(args[0] ?? 9400)
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const ws = new WebSocket(v.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
  setTimeout(() => process.exit(0), 1000)
} else {
  console.log('usage: phone-check.mjs start|open|stop ...')
  process.exit(2)
}
