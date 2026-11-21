import { messageFieldsOf, webmOpusToOgg, type AsyncJob } from 'shared-types'

/**
 * What every job that turns downloaded audio into a track shares (#964): the file format decision (`toTrackFormat`), the types by extension, and the
 * shape of what a job document is ever patched with. No job type and no add-on is named here.
 */

const MIME_TYPES_BY_EXT: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  webm: 'audio/webm',
  opus: 'audio/opus',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
}

/** yt-dlp writes the extension of the file it produced; an unlisted one still gets *a* playable guess rather than failing the job. */
export function mimeTypeForExt(ext: string): string {
  return MIME_TYPES_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream'
}

/**
 * The downloaded file as a track: Opus in WebM (YouTube's format 251, practically always) is re-wrapped into Ogg losslessly - every device then
 * starts it on the same sample (docs/30 §8h). Anything else stays as downloaded: a host has no decoder to encode it anew.
 */
export function toTrackFormat(data: Uint8Array, ext: string): { data: Uint8Array; mimeType: string; remuxed: boolean } {
  if (['webm', 'mkv'].includes(ext.toLowerCase())) {
    const ogg = webmOpusToOgg(data)
    if (ogg) return { data: ogg, mimeType: 'audio/ogg', remuxed: true }
  }
  return { data, mimeType: mimeTypeForExt(ext), remuxed: false }
}

/** What a job document is ever patched with: the fields every job shares, plus the result. */
export type JobPatch = Partial<Pick<AsyncJob, 'status' | 'progress' | 'error' | 'errorCode' | 'errorParams' | 'runner'>> & { trackId?: string; stemTrackIds?: string[] }

/** The `error` patch for a failure: the message, plus its code when it has one (#679). */
export function errorPatch(err: unknown): JobPatch {
  const { message, messageCode, messageParams } = messageFieldsOf(err)
  return { status: 'error', error: message, ...(messageCode ? { errorCode: messageCode } : {}), ...(messageParams ? { errorParams: messageParams } : {}) }
}

