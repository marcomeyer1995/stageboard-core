/** CouchDB's password keys (PBKDF2, salt used as text) - WebCrypto, so the same code runs in Node and in the app. */

export const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** `prf` as CouchDB names it: 'sha256' (CouchDB 3.4+) or 'sha' (SHA-1, older accounts). */
export async function pbkdf2(password: string, salt: string, iterations: number, prf: string = 'sha256'): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const hash = prf === 'sha' ? 'SHA-1' : 'SHA-256'
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations, hash }, key, prf === 'sha' ? 160 : 256)
  return hex(bits)
}

/** Constant-time string comparison - a password check must not tell how much matched. */
export function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** `Basic …` into user and password, or null. */
export function basicCredentials(authorization: string | undefined): { user: string; password: string } | null {
  if (!authorization?.startsWith('Basic ')) return null
  let decoded: string
  try {
    decoded = atob(authorization.slice(6))
  } catch {
    return null
  }
  const colon = decoded.indexOf(':')
  if (colon < 0) return null
  // atob gives one char per byte - turn UTF-8 bytes back into text.
  const text = (s: string) => new TextDecoder().decode(Uint8Array.from(s, (c) => c.charCodeAt(0)))
  return { user: text(decoded.slice(0, colon)), password: text(decoded.slice(colon + 1)) }
}
