import jsQR from 'jsqr'
import QRCode from 'qrcode'

/** Renders `text` as a QR code data URL - a thin wrapper so `InviteBandView.tsx` stays UI-only,
 * matching how `workspaceDb.ts` wraps PouchDB rather than components touching a 3rd-party
 * library directly. `text` is normally `buildJoinUrl`'s output below. */
export function renderQrCode(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: 256 })
}

/** Decodes one camera frame's `ImageData` into a QR code's text, or `null` if none is found -
 * `JoinBandView.tsx` calls this on a `requestAnimationFrame` loop over the video feed. Pass the
 * result to `parseJoinPayload` to get the workspace/code pair back out. */
export function decodeQrFrame(imageData: ImageData): string | null {
  const result = jsQR(imageData.data, imageData.width, imageData.height)
  return result?.data ?? null
}

/** Builds the URL an invite QR code encodes (see #21 seventh follow-up, at Marco's explicit
 * request) - a real `https://` URL, not just `workspaceId:code` text, so a phone's *native*
 * camera app can open it directly and land on the right Stage-Server before the PWA is even
 * running, not just the in-app scanner. `host` is normally the server's own current LAN IP
 * (`InviteBandView.tsx` fetches it fresh via `fetchLanIp()` every time the screen opens) -
 * baking in an address that might later change is exactly why re-opening "Einladen" always
 * re-embeds whatever the address currently is, rather than reusing a cached QR. */
export function buildJoinUrl(host: string, workspaceId: string, code: string): string {
  const url = new URL(`https://${host}/`)
  url.searchParams.set('ws', workspaceId)
  url.searchParams.set('code', code)
  return url.toString()
}

/** The inverse of `buildJoinUrl` - also still accepts the older plain `workspaceId:code` text
 * (2026-09-01's original WiFi-style QR format), so a code printed before this URL-based format
 * existed keeps scanning correctly. Used by both `JoinBandView.tsx`'s in-app scanner and, for a
 * `?ws=&code=` link opened fresh (no app running yet), `App.tsx`'s startup check. */
export function parseJoinPayload(text: string): { workspaceId: string; code: string } | null {
  try {
    const url = new URL(text)
    const workspaceId = url.searchParams.get('ws')
    const code = url.searchParams.get('code')
    if (workspaceId && code) return { workspaceId, code }
  } catch {
    // Not a URL - fall through to the legacy plain-text format below.
  }
  // No '/' check: rules out an unrelated URL (any real one contains at least the "//" after its
  // scheme) reaching here as a false-positive "workspaceId:code" pair via its own first ':' -
  // a real workspaceId/code pair never contains one.
  const separatorIndex = text.indexOf(':')
  if (separatorIndex > 0 && separatorIndex < text.length - 1 && !text.includes('/')) {
    return { workspaceId: text.slice(0, separatorIndex), code: text.slice(separatorIndex + 1) }
  }
  return null
}
