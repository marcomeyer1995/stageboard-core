import { Capacitor, registerPlugin } from '@capacitor/core'
import { useStageServerStore } from '../store/useStageServerStore'

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
