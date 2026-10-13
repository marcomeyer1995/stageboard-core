// Launch desktop Chrome headless, open a localhost page, grant MIDI, run probe.js, print result.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
const dir = new URL('.', import.meta.url).pathname
const probe = readFileSync(dir + 'probe.js', 'utf8')
const srv = createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>probe</title>') }).listen(8791)
const chrome = spawn('google-chrome', ['--headless=new', '--remote-debugging-port=9333', '--user-data-dir=' + mkdtempSync(tmpdir() + '/sbprobe-'), 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
await sleep(2000)
const tabs = await (await fetch('http://127.0.0.1:9333/json')).json()
const ver = await (await fetch('http://127.0.0.1:9333/json/version')).json()
const mk = url => new Promise(res => { const ws = new WebSocket(url); let id = 0; const pend = new Map(); ws.onmessage = e => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } }; ws.onopen = () => res((method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })) })
const browser = await mk(ver.webSocketDebuggerUrl)
await browser('Browser.grantPermissions', { origin: 'http://localhost:8791', permissions: ['midi', 'midiSysex'] })
const page = await mk(tabs.find(t => t.type === 'page').webSocketDebuggerUrl)
await page('Page.navigate', { url: 'http://localhost:8791/' }); await sleep(800)
const r = await page('Runtime.evaluate', { expression: probe + `\nsbMidiProbe(${JSON.stringify(process.argv[2] || 'SB Timing Probe')})`, awaitPromise: true, returnByValue: true })
console.log(JSON.stringify(r.result?.result?.value ?? r, null, 1))
chrome.kill(); srv.close(); process.exit(0)
