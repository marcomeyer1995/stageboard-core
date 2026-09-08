import { execFile } from 'node:child_process'
import { promises as dns } from 'node:dns'
import { promisify } from 'node:util'
import * as deviceInfoStore from './deviceInfoStore.js'

const execFileAsync = promisify(execFile)

const PING_INTERVAL_MS = 20_000
const PING_TIMEOUT_S = 1

/**
 * Background reachability/hostname refresh for every device currently known to
 * `deviceInfoStore` - the Device Ledger's "Netzwerk erreichbar" column (DeviceLedgerView.tsx,
 * Marco's explicit request). Deliberately server-side: no browser has ICMP access at all, but
 * this server already runs natively on Linux (no virtualization, per the project's own
 * tech-stack rule), so it can shell out to the system `ping` binary directly - not a raw
 * socket, so the Node process itself needs no elevated privileges (the OS `ping` executable
 * already carries whatever capability it needs).
 *
 * One process-wide loop, not per-workspace - `deviceInfoStore` is already keyed by workspaceId
 * internally, and this needs no CouchDB access at all (purely refreshes the in-memory store),
 * so unlike pluginSync.ts/midiWatcher.ts it doesn't need a configured `STAGEBOARD_WORKSPACE`.
 *
 * Deliberately a second, independent signal from `lastSeenAt`'s "is the app open" (see
 * deviceInfo.ts's doc comment on `networkReachable`) - a technician reading both together can
 * tell "device dropped off WiFi" apart from "device's on the network, app got closed." Caveat:
 * a screen-locked tablet's WiFi radio can go quiet even when the device is fine, so a `false`
 * here means "no network response right now," not a hard verdict.
 */
export interface PingLoop {
  stop(): void
}

async function pingOnce(ip: string): Promise<boolean> {
  try {
    await execFileAsync('ping', ['-c', '1', '-W', String(PING_TIMEOUT_S), ip])
    return true
  } catch {
    return false
  }
}

async function resolveHostname(ip: string): Promise<string | null> {
  try {
    const names = await dns.reverse(ip)
    return names[0] ?? null
  } catch {
    // ENOTFOUND is the expected/common case on a LAN with no reverse-DNS records - not an
    // error worth logging, let alone retrying aggressively for.
    return null
  }
}

/** Exported for pingLoop.test.ts - one refresh pass over every currently-known device, without
 * the setInterval scheduling around it. */
export async function tick(): Promise<void> {
  for (const { workspaceId, deviceId, ip } of deviceInfoStore.allEntries()) {
    const [networkReachable, hostname] = await Promise.all([pingOnce(ip), resolveHostname(ip)])
    deviceInfoStore.patchEntry(workspaceId, deviceId, { networkReachable, hostname })
  }
}

export function startPingLoop(): PingLoop {
  const interval = setInterval(() => {
    void tick()
  }, PING_INTERVAL_MS)
  void tick()

  return {
    stop: () => clearInterval(interval),
  }
}
