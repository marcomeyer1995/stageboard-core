import i18n from '../i18n'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { useHostUrlStore } from '../store/useHostUrlStore'
import { getHostUrl } from './hostUrl'

/**
 * The native Android app (#348): the same web build inside a Capacitor shell. Only a few places
 * differ from the browser - mainly that the app's own origin (`https://localhost`) isn't the
 * Host, so the host address comes from pairing, and the host's self-signed
 * certificate is trusted by fingerprint instead of a "Trotzdem fortfahren" tap.
 */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

/** The shell's certificate pinning (`HostTrustPlugin.java`): the WebView accepts a host's
 * certificate only if its SHA-256 fingerprint matches the one pinned for that host. */
interface HostTrustPlugin {
  pin(options: { host: string; fingerprint: string }): Promise<void>
  /** Reads the certificate the host presents (without trusting it) - for pairing by address. */
  fingerprintOf(options: { host: string }): Promise<{ fingerprint: string }>
  /** Downloads an update from the paired host (pinned certificate) and opens the installer. */
  downloadAndInstall(options: { url: string }): Promise<void>
  /** The fingerprint pinned for a host, or null. */
  pinned(options: { host: string }): Promise<{ fingerprint: string | null }>
}

const HostTrust = registerPlugin<HostTrustPlugin>('HostTrust')

/** A Host found on the network (`ServerDiscoveryPlugin.java`, DNS-SD `_stageboard._tcp`, #351). */
export interface FoundHost {
  name: string
  /** `address` or `address:port` - the form the app stores and pins. */
  host: string
  /** From the host's announcement - only used to recognise the paired host, never to trust a new one. */
  fingerprint: string | null
}

const HostDiscovery = registerPlugin<{ discover(options: { timeoutMs: number }): Promise<{ servers: { name: string; address: string; port: number; fingerprint: string | null }[] }> }>('HostDiscovery')

/** Hosts announcing themselves on the local network. Empty in the browser. */
export async function discoverHosts(timeoutMs = 3000): Promise<FoundHost[]> {
  if (!isNativeApp()) return []
  const { servers } = await HostDiscovery.discover({ timeoutMs })
  return servers
    .map((s) => ({ name: s.name, host: s.port === 443 ? s.address : `${s.address}:${s.port}`, fingerprint: s.fingerprint }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The paired host at a new address: the one announcing exactly the pinned fingerprint, on
 * another host. Never a host with a different certificate (#351). */
export function pickMovedHost(found: readonly FoundHost[], pinnedFingerprint: string, currentHost: string): FoundHost | null {
  return found.find((s) => s.fingerprint === pinnedFingerprint && s.host !== currentHost) ?? null
}

/**
 * Native app: if the paired Host doesn't answer at its stored address, look for it on the
 * network and switch to it silently when it is there under a new address with the same
 * certificate (#351) - e.g. another router at the venue gave it a new IP.
 */
export async function followHostIfMoved(): Promise<'reachable' | 'moved' | 'not-found' | 'skipped'> {
  const base = useHostUrlStore.getState().url
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
  const { fingerprint } = await HostTrust.pinned({ host: currentHost })
  if (!fingerprint) return 'not-found'
  const moved = pickMovedHost(await discoverHosts(4000), fingerprint, currentHost)
  if (!moved) return 'not-found'
  await pairWithHost(moved.host, fingerprint)
  return 'moved'
}

/** The address the app stores and pins for a host URL: the host, with the port only when it is not 443. */
export function hostOfUrl(url: string): string {
  const parsed = new URL(url)
  return parsed.port && parsed.port !== '443' ? `${parsed.hostname}:${parsed.port}` : parsed.hostname
}

/**
 * Which of the band's listed hosts the app should pin (host backup, #916): those with a fingerprint that
 * are not pinned yet. The admin entered the fingerprint once on the stage map, and a fingerprint from the
 * band settings counts as trusted (Marco, 2026-11-17) - so every device can move to the backup without
 * having confirmed its certificate itself. A host already pinned to a *different* fingerprint is never
 * overwritten: a changed certificate is a conflict to report, not something to trust silently.
 */
export function hostsToPin(
  hosts: readonly { url: string; certFingerprint?: string }[],
  pinned: Readonly<Record<string, string | null>>,
): { pin: { host: string; fingerprint: string }[]; conflicts: string[] } {
  const pin: { host: string; fingerprint: string }[] = []
  const conflicts: string[] = []
  for (const entry of hosts) {
    if (!entry.certFingerprint) continue
    const host = hostOfUrl(entry.url)
    const have = pinned[host] ?? null
    if (have === null) pin.push({ host, fingerprint: entry.certFingerprint })
    else if (have !== entry.certFingerprint) conflicts.push(host)
  }
  return { pin, conflicts }
}

/** Pins the listed hosts the shell does not know yet. Never throws: without a shell nothing is pinned. */
export async function pinListedHosts(hosts: readonly { url: string; certFingerprint?: string }[]): Promise<{ pin: { host: string; fingerprint: string }[]; conflicts: string[] }> {
  try {
    const pinned: Record<string, string | null> = {}
    for (const entry of hosts) {
      const host = hostOfUrl(entry.url)
      pinned[host] = (await HostTrust.pinned({ host })).fingerprint
    }
    const result = hostsToPin(hosts, pinned)
    for (const { host, fingerprint } of result.pin) await HostTrust.pin({ host, fingerprint })
    return result
  } catch {
    return { pin: [], conflicts: [] }
  }
}

/** "aa bb cc …": the first bytes of a fingerprint, readable enough to compare by eye. */
export function shortFingerprint(fingerprint: string): string {
  return (fingerprint.match(/../g) ?? []).slice(0, 8).join(' ').toUpperCase()
}

/** Pairs this app with a Host: pins its certificate and makes it the host address. */
export async function pairWithHost(host: string, fingerprint: string): Promise<void> {
  await HostTrust.pin({ host, fingerprint: fingerprint.toLowerCase() })
  useHostUrlStore.getState().setUrl(`https://${host}`)
}

/** The certificate fingerprint a host presents, for pairing by a typed-in address. */
export async function hostFingerprint(host: string): Promise<string> {
  return (await HostTrust.fingerprintOf({ host })).fingerprint
}

/** This app build's number (scripts/build-android-app.sh) - 0 for a dev/debug build. */
export const APP_VERSION_CODE = Number(import.meta.env.VITE_APP_VERSION_CODE ?? 0)

export interface AppUpdate {
  versionCode: number
  versionName: string
}

/** The app build the paired Host offers - null without a host, when it has no app
 * build, or when it can't be reached. */
export async function fetchOfferedAppVersion(): Promise<AppUpdate | null> {
  const base = getHostUrl()
  if (!base) return null
  try {
    const response = await fetch(`${base}/app/version.json`)
    if (!response.ok) return null
    return (await response.json()) as AppUpdate
  } catch {
    return null
  }
}

/** The host's app build if it is newer than this one. Null in the browser, for dev builds, and
 * whenever `fetchOfferedAppVersion` has nothing. */
export async function checkForAppUpdate(): Promise<AppUpdate | null> {
  if (!isNativeApp() || APP_VERSION_CODE === 0) return null
  const offered = await fetchOfferedAppVersion()
  return offered && offered.versionCode > APP_VERSION_CODE ? offered : null
}

/** Downloads the host's app build and opens Android's installer. */
export async function installAppUpdate(): Promise<void> {
  const base = getHostUrl()
  if (!base) throw new Error('Kein Host verbunden')
  await HostTrust.downloadAndInstall({ url: `${base}/app/stageboard.apk` })
}

/** The native side's own reason for a failed update (e.g. "certificate is not the paired one"),
 * shown with the message - without it a failure on one phone could not be told apart (2026-10-20). */
export function updateFailureReason(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/^Update failed: /, '') || i18n.t('system:unknownError')
}

/** The question asked before trusting a Host's certificate (#377): name, address and the
 * fingerprint each on their own line instead of one long sentence. */
export function pairingConfirmation(name: string, host: string, fingerprint: string): { title: string; message: string } {
  const where = name && name !== host ? `${name}\n${host}` : host
  return {
    title: i18n.t('band:pairing.title'),
    message: i18n.t('band:pairing.message', { where, fingerprint: shortFingerprint(fingerprint) }),
  }
}

const NativePrint = registerPlugin<{ print(options: { name: string }): Promise<void> }>('Print')

/** Prints the page (its print styles decide what is on paper): the browser's own dialog, in the
 * app Android's print dialog via `PrintPlugin.java` - the WebView ignores window.print(). */
export async function printPage(name: string): Promise<void> {
  if (isNativeApp()) await NativePrint.print({ name })
  else window.print()
}
