/** Playing length of an audio file in ms, read from its metadata (no decoding) - or null when
 * the browser can't tell (unsupported format, unknown length, no audio support at all). */
export function measureAudioDurationMs(blob: Blob, timeoutMs = 8000): Promise<number | null> {
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
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : null)
    audio.onerror = () => finish(null)
    audio.src = url
  })
}
