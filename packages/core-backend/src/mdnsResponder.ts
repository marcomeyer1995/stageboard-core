import { createSocket as createDgramSocket, type Socket } from 'node:dgram'
import mdnsFactory from 'multicast-dns'

/** How long to wait before trying again when the network isn't up yet. */
export const MDNS_RETRY_MS = 5000

export interface MdnsResponderOptions {
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
  const { lanIp, hostname, log, retryMs = MDNS_RETRY_MS, createSocket = createMdnsSocket } = options
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
      if (query.questions.some((q) => q.type === 'A' && q.name === hostname)) {
        mdns?.respond({ answers: [{ name: hostname, type: 'A', ttl: 120, data: lanIp }] })
      }
    })
    mdns.on('error', (err) => log.error(`mDNS responder for ${hostname} failed - falling back to raw IP access`, { error: String(err) }))
    log.info(`Advertising ${hostname} -> ${lanIp} via mDNS`)
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
