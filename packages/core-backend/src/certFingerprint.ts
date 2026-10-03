import { X509Certificate } from 'node:crypto'

/** SHA-256 fingerprint of a PEM certificate: lowercase hex, no separators - the form the native
 * app's certificate pinning compares against (#348). */
export function certFingerprint(pem: string): string {
  return new X509Certificate(pem).fingerprint256.replace(/:/g, '').toLowerCase()
}
