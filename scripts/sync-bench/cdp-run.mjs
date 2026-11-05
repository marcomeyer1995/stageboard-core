import { readFileSync } from 'node:fs'
const [port, file] = process.argv.slice(2)
const expr = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8')
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl)
await new Promise(r => ws.onopen = r)
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id === 1) { const v = m.result.result?.value; console.log(typeof v === 'string' ? v : JSON.stringify(m.result)); ws.close() } }
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
