// serve-build.mjs PORT DIST - the measurement browser loads the app files (index.html, assets/...) from a
// local build instead of the Stage-Server - same origin, so its band data and pairing stay. Everything
// else (/time, /workspaces/..., the database) still goes to the real server.
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
const [port, dist, inject] = process.argv.slice(2)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl)
await new Promise(r => ws.onopen = r)
let id = 0; const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }))
let served = 0
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (m.method !== 'Fetch.requestPaused') return
  const { requestId, request } = m.params
  const url = new URL(request.url)
  let path = url.pathname === '/' ? '/index.html' : url.pathname
  let file = join(dist, path)
  // Only page loads get the app page - a track download or an API call must reach the server.
  const appRoute = m.params.resourceType === 'Document' && !path.includes('.')
  if (appRoute) file = join(dist, 'index.html')
  if (request.method === 'GET' && existsSync(file) && statSync(file).isFile()) {
    served++
    send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: types[extname(file)] ?? 'application/octet-stream' }, { name: 'Cache-Control', value: 'no-store' }], body: readFileSync(file).toString('base64') })
  } else send('Fetch.continueRequest', { requestId })
}
send('Network.enable'); send('Network.setBypassServiceWorker', { bypass: true }); send('Network.setCacheDisabled', { cacheDisabled: true })
send('Fetch.enable', { patterns: [{ urlPattern: 'https://192.168.178.158/*', requestStage: 'Request' }] })
// A script to run before the app on every load (the capture hook) - registered on this session,
// which stays attached; Chrome drops it when the registering session goes.
if (inject) { send('Page.enable'); send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(inject, 'utf8') }); send('Page.reload', { ignoreCache: true }) }
setInterval(() => process.stdout.write(`served ${served}\r`), 5000)
