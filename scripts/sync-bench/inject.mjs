import { readFileSync } from 'node:fs'
const [port, file] = process.argv.slice(2)
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl)
await new Promise(r => ws.onopen = r)
let id = 0
const send = (method, params) => new Promise(res => { const my = ++id; const h = e => { const m = JSON.parse(e.data); if (m.id === my) { ws.removeEventListener('message', h); res(m) } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id: my, method, params })) })
await send('Page.enable', {})
console.log(JSON.stringify(await send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(file, "utf8") })))
console.log(JSON.stringify(await send('Page.reload', {})))
ws.close()
