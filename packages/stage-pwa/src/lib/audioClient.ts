/**
 * Talks to core-backend's `/audio/:variantId/:trackId` routes (see #30) - the canonical
 * store for track audio now lives on the Stage-Server's disk, not as a PouchDB attachment,
 * so tablets no longer receive every band's whole audio catalog through the `song-variants`
 * live sync stream. Mirrors showControlClient.ts's shape (inline base-URL read, no shared
 * helper extracted across these client files).
 */

function audioUrl(variantId: string, trackId: string): string | null {
  const base = import.meta.env.VITE_STAGE_SERVER_URL as string | undefined
  if (!base) return null
  return `${base}/audio/${encodeURIComponent(variantId)}/${encodeURIComponent(trackId)}`
}

export type AudioUploadResult = { status: 'ok' } | { status: 'error'; message: string }

export async function uploadTrack(
  variantId: string,
  trackId: string,
  file: Blob,
): Promise<AudioUploadResult> {
  const url = audioUrl(variantId, trackId)
  if (!url) return { status: 'error', message: 'VITE_STAGE_SERVER_URL is not configured' }

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!response.ok) return { status: 'error', message: `HTTP ${response.status}` }
    return { status: 'ok' }
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}

/** `null` on a missing track, a misconfigured server URL, or a network failure - every case
 * where the caller should fall back to "not available", not throw. */
export async function fetchTrack(variantId: string, trackId: string): Promise<Blob | null> {
  const url = audioUrl(variantId, trackId)
  if (!url) return null

  try {
    const response = await fetch(url)
    if (!response.ok) return null
    return await response.blob()
  } catch {
    return null
  }
}

/** A missing track is not an error here either - matches deleteAudioFile's no-op-if-missing
 * behavior on the server. */
export async function deleteTrackFile(variantId: string, trackId: string): Promise<void> {
  const url = audioUrl(variantId, trackId)
  if (!url) return
  await fetch(url, { method: 'DELETE' }).catch(() => {})
}
