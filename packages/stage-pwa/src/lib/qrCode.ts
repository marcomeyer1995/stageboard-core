import jsQR from 'jsqr'
import QRCode from 'qrcode'

/** Renders `text` (a band's `workspaceId:code` pair, see #21/2026-09-01's WiFi-style redesign)
 * as a QR code data URL - a thin wrapper so `InviteBandView.tsx` stays UI-only, matching how
 * `workspaceDb.ts` wraps PouchDB rather than components touching a 3rd-party library directly. */
export function renderQrCode(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: 256 })
}

/** Decodes one camera frame's `ImageData` into a QR code's text, or `null` if none is found -
 * `JoinBandView.tsx` calls this on a `requestAnimationFrame` loop over the video feed. */
export function decodeQrFrame(imageData: ImageData): string | null {
  const result = jsQR(imageData.data, imageData.width, imageData.height)
  return result?.data ?? null
}
