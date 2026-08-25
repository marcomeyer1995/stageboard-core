/**
 * Random v4 UUID that also works over plain http on the stage LAN.
 *
 * `crypto.randomUUID()` is restricted to secure contexts, so on a tablet opening
 * http://<stage-server>:5173 it is simply undefined - exactly the setup StageBoard is
 * built for (docs/02: local network, no internet, no certificates). `getRandomValues`
 * carries no such restriction, so it is the fallback.
 */
export function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10x
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}
