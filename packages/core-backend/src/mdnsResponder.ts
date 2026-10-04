import { createSocket as createDgramSocket, type Socket } from 'node:dgram'
import mdnsFactory from 'multicast-dns'

/** How long to wait before trying again when the network isn't up yet. */
export const MDNS_RETRY_MS = 5000

/** DNS-SD service type the native app browses for (#351). */
export const SERVICE_TYPE = '_stageboard._tcp.local'
const SERVICES_META = '_services._dns-sd._udp.local'

export interface MdnsIdentity {
  lanIp: string
  hostname: string
  /** HTTPS port of the Stage-Server. */
  port: number
  /** Human-readable server name, shown in the app's server list - no dots. */
  instance: string
  /** SHA-256 certificate fingerprint (lowercase hex), or null without HTTPS. */
  certFingerprint: string | null
}

interface MdnsQuestion {
  name: string
  type: string
}
type MdnsRecord =
  | { name: string; type: 'A'; ttl: number; data: string }
  | { name: string; type: 'PTR'; ttl: number; data: string }
  | { name: string; type: 'SRV'; ttl: number; data: { port: number; target: string } }
  | { name: string; type: 'TXT'; ttl: number; data: string[] }

/**
 * What to answer for one mDNS query (#351): the A record for the hostname (since docs/03 §0a),
 * and DNS-SD for `_stageboard._tcp` - PTR to this server's instance, SRV (port, hostname) and TXT
 * with the certificate fingerprint, so the app can list servers and recognise the one it is paired
 * with at a new address. Null when the query isn't about this server.
 */
export function mdnsAnswer(questions: readonly MdnsQuestion[], id: MdnsIdentity): { answers: MdnsRecord[]; additionals: MdnsRecord[] } | null {
  const instanceName = `${id.instance}.${SERVICE_TYPE}`
  const a: MdnsRecord = { name: id.hostname, type: 'A', ttl: 120, data: id.lanIp }
  const srv: MdnsRecord = { name: instanceName, type: 'SRV', ttl: 120, data: { port: id.port, target: id.hostname } }
  const txt: MdnsRecord = { name: instanceName, type: 'TXT', ttl: 120, data: ['v=1', ...(id.certFingerprint ? [`fp=${id.certFingerprint}`] : [])] }
  const answers: MdnsRecord[] = []
  const additionals: MdnsRecord[] = []
  const add = (list: MdnsRecord[], record: MdnsRecord) => {
    if (!answers.includes(record) && !additionals.includes(record)) list.push(record)
  }
  for (const q of questions) {
    const name = q.name.toLowerCase()
    if (name === id.hostname.toLowerCase() && (q.type === 'A' || q.type === 'ANY')) add(answers, a)
    else if (name === SERVICES_META && q.type === 'PTR') answers.push({ name: SERVICES_META, type: 'PTR', ttl: 120, data: SERVICE_TYPE })
    else if (name === SERVICE_TYPE && (q.type === 'PTR' || q.type === 'ANY')) {
      answers.push({ name: SERVICE_TYPE, type: 'PTR', ttl: 120, data: instanceName })
      add(additionals, srv)
      add(additionals, txt)
      add(additionals, a)
    } else if (name === instanceName.toLowerCase()) {
      if (q.type === 'SRV' || q.type === 'ANY') add(answers, srv)
      if (q.type === 'TXT' || q.type === 'ANY') add(answers, txt)
      add(additionals, a)
    }
  }
  return answers.length > 0 ? { answers, additionals: additionals.filter((r) => !answers.includes(r)) } : null
}

export interface MdnsResponderOptions extends Omit<MdnsIdentity, 'lanIp' | 'hostname'> {
  lanIp: string
  hostname: string
  log: {
    info: (msg: string, meta?: Record<string, unknown>) => void
    error: (msg: string, meta?: Record<string, unknown>) => void
  }
  retryMs?: number
  /** Injectable for tests. */
  createSocket?: (lanIp: string) => Promise<Socket>
}

export interface MdnsResponderHandle {
  stop: () => Promise<void>
}

/**
 * Answers "who is `hostname`" with `lanIp` over mDNS (see main()'s doc comment in index.ts for
 * why it's built this way). Never throws: at boot the service can start before Wi-Fi has its
 * address, and joining the multicast group then fails (`addMembership ENODEV`) - that used to
 * crash the whole Stage-Server (#339). It now logs once and retries every `retryMs` until the
 * network is up; the server works by raw IP meanwhile.
 */
export function startMdnsResponder(options: MdnsResponderOptions): MdnsResponderHandle {
  const { lanIp, hostname, port, instance, certFingerprint, log, retryMs = MDNS_RETRY_MS, createSocket = createMdnsSocket } = options
  const identity: MdnsIdentity = { lanIp, hostname, port, instance, certFingerprint }
  let stopped = false
  let failedBefore = false
  let retry: ReturnType<typeof setTimeout> | null = null
  let mdns: ReturnType<typeof mdnsFactory> | null = null

  async function attempt(): Promise<void> {
    retry = null
    let socket: Socket
    try {
      socket = await createSocket(lanIp)
    } catch (err) {
      if (!failedBefore) {
        failedBefore = true
        log.error(`mDNS responder for ${hostname} not started yet - retrying, raw IP works meanwhile`, { error: String(err), lanIp })
      }
      if (!stopped) retry = setTimeout(() => void attempt(), retryMs)
      return
    }
    if (stopped) {
      socket.close()
      return
    }
    mdns = mdnsFactory({ socket, bind: false })
    mdns.on('query', (query) => {
      const response = mdnsAnswer(query.questions, identity)
      if (response) mdns?.respond(response as Parameters<NonNullable<typeof mdns>['respond']>[0])
    })
    mdns.on('error', (err) => log.error(`mDNS responder for ${hostname} failed - falling back to raw IP access`, { error: String(err) }))
    log.info(`Advertising ${hostname} -> ${lanIp} via mDNS (service "${instance}" ${SERVICE_TYPE})`)
  }

  void attempt()

  return {
    stop: async () => {
      stopped = true
      if (retry) clearTimeout(retry)
      const running = mdns
      mdns = null
      if (running) await new Promise<void>((resolve) => running.destroy(() => resolve()))
    },
  }
}

/** Builds and fully configures the UDP socket the mDNS responder uses, rather than letting
 * `multicast-dns` create and configure its own - see main()'s doc comment in index.ts for why
 * (in short: its own outgoing-interface selection isn't reliable on a machine with Docker's
 * virtual network interfaces present). Bind stays on the wildcard address (`0.0.0.0`, Node's
 * `dgram` default with no address argument) - binding to `lanIp` specifically instead, which
 * seems like the more obviously-correct choice, was tried first and silently breaks *receiving*
 * multicast traffic on Linux. `setMulticastInterface(lanIp)` is what actually pins outgoing
 * packets to the real interface. Rejects (and closes the socket) when the interface isn't ready. */
function createMdnsSocket(lanIp: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createDgramSocket({ type: 'udp4', reuseAddr: true })
    socket.once('error', reject)
    socket.bind(5353, () => {
      socket.removeListener('error', reject)
      try {
        socket.addMembership('224.0.0.251', lanIp)
        socket.setMulticastTTL(255)
        socket.setMulticastLoopback(true)
        socket.setMulticastInterface(lanIp)
        resolve(socket)
      } catch (err) {
        socket.close()
        reject(err)
      }
    })
  })
}
