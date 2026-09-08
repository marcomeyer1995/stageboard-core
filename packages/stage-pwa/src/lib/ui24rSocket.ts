/**
 * Thin client for the Soundcraft Ui24R's raw control transport - a legacy Socket.IO
 * 0.9-style text envelope (`1::`/`2::`/`3:::<payload>`) over a plain `ws://<host>:<port>/`
 * WebSocket, no separate HTTP handshake step. None of this is officially published by
 * Harman/Soundcraft - reverse-engineered (with attribution) from `fmalcher/soundcraft-ui`
 * (MIT) and reproduced in `~/Device Emulators/Soundcraft UI24R Emulator/docs/protocol-
 * notes.md`, which this file's structure mirrors 1:1 (see that emulator's own
 * `server.py`/`device.py` for the server-side counterpart of every behavior here).
 *
 * Only implements the wire mechanics: connect, track received `SETD`/`SETS` state, send
 * `SETD`/`SETS`, keep the connection alive. `ui24rTranslator.ts` builds the actual plugin
 * actions on top of this.
 *
 * One connection is cached per `host:port` (mirroring webMidiOutput.ts's cached
 * `MIDIAccess`) so a plugin's actions and its 'test' both reuse the same live socket and
 * observe the same received state, rather than reconnecting on every call.
 */

export interface Ui24rConnection {
  ws: WebSocket
  /** Every `SETD`/`SETS` path this connection has observed since opening - the initial
   * state dump plus anything broadcast since (docs/protocol-notes.md's "Broadcast, not
   * reply": every set, including this client's own, comes back on this same channel). */
  state: Map<string, number | string>
}

const connections = new Map<string, Ui24rConnection>()
// The reference client's own keepalive cadence (docs/protocol-notes.md's transport
// section: "a 1000ms ALIVE interval") - this emulator never actually enforces a timeout,
// but a real Ui24R's behavior here is unconfirmed, so this plugin behaves like a real
// client regardless.
const ALIVE_INTERVAL_MS = 1000

function parseLine(line: string, state: Map<string, number | string>): void {
  if (!line || line === 'ALIVE') return
  const kind = line.slice(0, 4)
  if (kind !== 'SETD' && kind !== 'SETS') return
  const rest = line.slice(5)
  const sep = rest.indexOf('^')
  if (sep === -1) return
  const path = rest.slice(0, sep)
  const raw = rest.slice(sep + 1)
  state.set(path, kind === 'SETD' ? Number(raw) : raw)
}

function open(host: string, port: number): Ui24rConnection {
  const key = `${host}:${port}`
  const existing = connections.get(key)
  if (existing && existing.ws.readyState !== WebSocket.CLOSED) return existing

  const state = new Map<string, number | string>()
  const ws = new WebSocket(`ws://${host}:${port}/`)

  ws.addEventListener('open', () => {
    const keepalive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('3:::ALIVE')
      else clearInterval(keepalive)
    }, ALIVE_INTERVAL_MS)
  })
  ws.addEventListener('message', (event) => {
    const raw = String(event.data)
    if (raw === '2::') {
      // Heartbeat echo - docs/protocol-notes.md: "a real client echoes 2:: back".
      if (ws.readyState === WebSocket.OPEN) ws.send('2::')
      return
    }
    if (!raw.startsWith('3:::')) return // '1::' (handshake) and anything else: nothing to parse
    for (const line of raw.slice(4).split('\n')) parseLine(line, state)
  })
  ws.addEventListener('close', () => connections.delete(key))

  const connection: Ui24rConnection = { ws, state }
  connections.set(key, connection)
  return connection
}

/** Opens (or reuses) the connection to `host:port`, resolving once the socket itself is
 * open - the initial state dump (docs/protocol-notes.md: every path sent once, in order,
 * right after the mixer's own `1::`) arrives asynchronously afterward and is reflected
 * into `connection.state` as it comes in, not necessarily complete by the time this
 * resolves. Rejects if the connection doesn't open within `timeoutMs`. */
export function getUi24rConnection(host: string, port: number, timeoutMs = 3000): Promise<Ui24rConnection> {
  const connection = open(host, port)
  if (connection.ws.readyState === WebSocket.OPEN) return Promise.resolve(connection)

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      connection.ws.removeEventListener('open', onOpen)
      connection.ws.removeEventListener('error', onError)
      reject(new Error('Ui24R: Zeitüberschreitung beim Verbindungsaufbau.'))
    }, timeoutMs)
    function onOpen() {
      clearTimeout(timer)
      connection.ws.removeEventListener('error', onError)
      resolve(connection)
    }
    function onError() {
      clearTimeout(timer)
      connection.ws.removeEventListener('open', onOpen)
      reject(new Error('Ui24R: Verbindung fehlgeschlagen.'))
    }
    connection.ws.addEventListener('open', onOpen)
    connection.ws.addEventListener('error', onError)
  })
}

/** Sends one `SETD` (numeric value) or `SETS` (string value) message. */
export function sendUi24r(connection: Ui24rConnection, path: string, value: number | string): void {
  const kind = typeof value === 'number' ? 'SETD' : 'SETS'
  connection.ws.send(`3:::${kind}^${path}^${value}`)
}
