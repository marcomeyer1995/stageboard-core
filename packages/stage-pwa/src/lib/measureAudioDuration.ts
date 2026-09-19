/** Length from the file's metadata via an <audio> element - cheap, but some formats (an m4a with
 * its index at the end, an mp3 without a length header) don't report a usable duration. */
function measureViaMetadata(blob: Blob, timeoutMs: number): Promise<number | null> {
  if (typeof Audio === 'undefined' || typeof URL.createObjectURL !== 'function') return Promise.resolve(null)
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const audio = new Audio()
    let settled = false
    const finish = (ms: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      audio.removeAttribute('src')
      URL.revokeObjectURL(url)
      resolve(ms)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : null)
    audio.onerror = () => finish(null)
    audio.src = url
  })
}

/** Slower but format-independent: decodes the whole file. Only used when the metadata read fails. */
async function measureViaDecode(blob: Blob): Promise<number | null> {
  const Context =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  if (!Context) return null
  const context = new Context()
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    return decoded.duration > 0 ? Math.round(decoded.duration * 1000) : null
  } catch {
    return null
  } finally {
    void context.close().catch(() => {})
  }
}

/** Playing length of an audio file in ms - metadata first, a full decode as fallback - or null
 * when neither works (unsupported format, no audio support at all). */
export async function measureAudioDurationMs(blob: Blob, timeoutMs = 8000): Promise<number | null> {
  return (await measureViaMetadata(blob, timeoutMs)) ?? (await measureViaDecode(blob))
}
