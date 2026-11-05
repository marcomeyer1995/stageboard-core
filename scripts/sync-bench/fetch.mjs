import { readFileSync, writeFileSync } from 'node:fs'
const [port, out] = process.argv.slice(2)
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl)
await new Promise(r => ws.onopen = r)
ws.onmessage = e => {
  const m = JSON.parse(e.data); if (m.id !== 1) return
  if (m.result.exceptionDetails) { console.log(JSON.stringify(m.result.exceptionDetails).slice(0, 400)); process.exit(1) }
  writeFileSync(out, m.result.result.value); ws.close()
}
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: readFileSync(new URL('./export.js', import.meta.url), 'utf8'), returnByValue: true } }))
