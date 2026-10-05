import { Capacitor, registerPlugin } from '@capacitor/core'
import { useStageServerStore } from '../store/useStageServerStore'
import { getStageServerUrl } from './stageServer'

/**
 * The native Android app (#348): the same web build inside a Capacitor shell. Only a few places
 * differ from the browser - mainly that the app's own origin (`https://localhost`) isn't the
 * Stage-Server, so the server address comes from pairing, and the server's self-signed
 * certificate is trusted by fingerprint instead of a "Trotzdem fortfahren" tap.
 */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

/** The shell's certificate pinning (`ServerTrustPlugin.java`): the WebView accepts a server's
 * certificate only if its SHA-256 fingerprint matches the one pinned for that host. */
interface ServerTrustPlugin {
  pin(options: { host: string; fingerprint: string }): Promise<void>
  /** Reads the certificate the server presents (without trusting it) - for pairing by address. */
  fingerprintOf(options: { host: string }): Promise<{ fingerprint: string }>
  /** Downloads an update from the paired server (pinned certificate) and opens the installer. */
  downloadAndInstall(options: { url: string }): Promise<void>
  /** The fingerprint pinned for a host, or null. */
  pinned(options: { host: string }): Promise<{ fingerprint: string | null }>
}

const ServerTrust = registerPlugin<ServerTrustPlugin>('ServerTrust')

/** A Stage-Server found on the network (`ServerDiscoveryPlugin.java`, DNS-SD `_stageboard._tcp`, #351). */
export interface FoundServer {
  name: string
  /** `address` or `address:port` - the form the app stores and pins. */
  host: string
  /** From the server's announcement - only used to recognise the paired server, never to trust a new one. */
  fingerprint: string | null
}

const ServerDiscovery = registerPlugin<{ discover(options: { timeoutMs: number }): Promise<{ servers: { name: string; address: string; port: number; fingerprint: string | null }[] }> }>('ServerDiscovery')

/** Stage-Servers announcing themselves on the local network. Empty in the browser. */
export async function discoverServers(timeoutMs = 3000): Promise<FoundServer[]> {
  if (!isNativeApp()) return []
  const { servers } = await ServerDiscovery.discover({ timeoutMs })
  return servers
    .map((s) => ({ name: s.name, host: s.port === 443 ? s.address : `${s.address}:${s.port}`, fingerprint: s.fingerprint }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The paired server at a new address: the one announcing exactly the pinned fingerprint, on
 * another host. Never a server with a different certificate (#351). */
export function pickMovedServer(found: readonly FoundServer[], pinnedFingerprint: string, currentHost: string): FoundServer | null {
  return found.find((s) => s.fingerprint === pinnedFingerprint && s.host !== currentHost) ?? null
}

/**
 * Native app: if the paired Stage-Server doesn't answer at its stored address, look for it on the
 * network and switch to it silently when it is there under a new address with the same
 * certificate (#351) - e.g. another router at the venue gave it a new IP.
 */
export async function followServerIfMoved(): Promise<'reachable' | 'moved' | 'not-found' | 'skipped'> {
  const base = useStageServerStore.getState().url
  if (!isNativeApp() || !base) return 'skipped'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    if ((await fetch(`${base}/time`, { signal: controller.signal })).ok) return 'reachable'
  } catch {
    // Unreachable - look for it below.
  } finally {
    clearTimeout(timer)
  }
  const currentHost = new URL(base).host
  const { fingerprint } = await ServerTrust.pinned({ host: currentHost })
  if (!fingerprint) return 'not-found'
  const moved = pickMovedServer(await discoverServers(4000), fingerprint, currentHost)
  if (!moved) return 'not-found'
  await pairWithServer(moved.host, fingerprint)
  return 'moved'
}

/** "aa bb cc …": the first bytes of a fingerprint, readable enough to compare by eye. */
export function shortFingerprint(fingerprint: string): string {
  return (fingerprint.match(/../g) ?? []).slice(0, 8).join(' ').toUpperCase()
}

/** Pairs this app with a Stage-Server: pins its certificate and makes it the server address. */
export async function pairWithServer(host: string, fingerprint: string): Promise<void> {
  await ServerTrust.pin({ host, fingerprint: fingerprint.toLowerCase() })
  useStageServerStore.getState().setUrl(`https://${host}`)
}

/** The certificate fingerprint a host presents, for pairing by a typed-in address. */
export async function serverFingerprint(host: string): Promise<string> {
  return (await ServerTrust.fingerprintOf({ host })).fingerprint
}

/** This app build's number (scripts/build-android-app.sh) - 0 for a dev/debug build. */
export const APP_VERSION_CODE = Number(import.meta.env.VITE_APP_VERSION_CODE ?? 0)

export interface AppUpdate {
  versionCode: number
  versionName: string
}

/** The app build the paired Stage-Server offers - null without a server, when it has no app
 * build, or when it can't be reached. */
export async function fetchOfferedAppVersion(): Promise<AppUpdate | null> {
  const base = getStageServerUrl()
  if (!base) return null
  try {
    const response = await fetch(`${base}/app/version.json`)
    if (!response.ok) return null
    return (await response.json()) as AppUpdate
  } catch {
    return null
  }
}

/** The server's app build if it is newer than this one. Null in the browser, for dev builds, and
 * whenever `fetchOfferedAppVersion` has nothing. */
export async function checkForAppUpdate(): Promise<AppUpdate | null> {
  if (!isNativeApp() || APP_VERSION_CODE === 0) return null
  const offered = await fetchOfferedAppVersion()
  return offered && offered.versionCode > APP_VERSION_CODE ? offered : null
}

/** Downloads the server's app build and opens Android's installer. */
export async function installAppUpdate(): Promise<void> {
  const base = getStageServerUrl()
  if (!base) throw new Error('Kein Stage-Server verbunden')
  await ServerTrust.downloadAndInstall({ url: `${base}/app/stageboard.apk` })
}

/** The question asked before trusting a Stage-Server's certificate (#377): name, address and the
 * fingerprint each on their own line instead of one long sentence. */
export function pairingConfirmation(name: string, host: string, fingerprint: string): { title: string; message: string } {
  const where = name && name !== host ? `${name}\n${host}` : host
  return {
    title: 'Mit diesem Stage-Server verbinden?',
    message: `${where}\n\nZertifikat: ${shortFingerprint(fingerprint)}\nZum Vergleich steht es auf dem Admin-Gerät unter „Einladen“.`,
  }
}
