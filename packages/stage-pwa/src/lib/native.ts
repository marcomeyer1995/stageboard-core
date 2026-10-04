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
}

const ServerTrust = registerPlugin<ServerTrustPlugin>('ServerTrust')

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

