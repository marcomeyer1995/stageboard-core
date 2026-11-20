// The add-on side of the Node sandbox (#964). Started by core-backend/src/addons/nodeSandbox.ts as
//   node --permission --allow-fs-read=<this file> --allow-fs-read=<the add-on file> addon_runner.mjs <add-on file>
// so everything below runs with Node's permission model on: no other file can be read, none written, no program and no worker started.
// It gives a classic Worker script (the same file a tablet runs in a Worker, docs/32 §4) the Worker's surface - `self.postMessage`,
// `self.onmessage`, `console`, timers - and carries the messages over the IPC channel its parent opened. It is NOT a security boundary of its
// own: a vm context can be escaped. The boundary is the permission model the process was started with (see the tests).
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const addonFile = process.argv[2]
const withHttp = process.argv.includes('--http')
const send = (message) => process.send?.(message)
const self = {
  postMessage: (message) => send(message),
  onmessage: null,
  onerror: null,
  addEventListener: (type, listener) => {
    if (type === 'message') listeners.push(listener)
  },
}
const listeners = []
const sandboxGlobals = {
  self,
  postMessage: self.postMessage,
  console: { log: (...a) => send({ type: 'log', line: a.join(' ') }), warn: (...a) => send({ type: 'log', line: a.join(' ') }), error: (...a) => send({ type: 'log', line: a.join(' ') }) },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  TextEncoder,
  TextDecoder,
  URL,
  URLSearchParams,
  ...(withHttp ? { fetch, Headers, Request, Response, AbortController } : {}),
}
try {
  vm.runInNewContext(readFileSync(addonFile, 'utf8'), sandboxGlobals, { filename: addonFile })
} catch (err) {
  send({ type: 'health', status: 'error', message: `The add-on could not start: ${err?.message ?? err}` })
  process.exit(1)
}
// The host is gone (it was stopped, or killed): so is the add-on. An add-on that holds a timer open must not outlive the host.
process.on('disconnect', () => process.exit(0))
// Both protocols pass through untouched: a protocol 2 message (`type`) and a contract envelope (`kind`) are the add-on's business, and the sandbox
// routes by shape (#964, docs/36 §9). The runner never rewrites a message, so the same script works in a Worker and here.
process.on('message', (data) => {
  try {
    self.onmessage?.({ data })
    for (const listener of listeners) listener({ data })
  } catch (err) {
    send({ type: 'health', status: 'error', message: `The add-on threw: ${err?.message ?? err}` })
  }
})
send({ type: 'health', status: 'online' })
