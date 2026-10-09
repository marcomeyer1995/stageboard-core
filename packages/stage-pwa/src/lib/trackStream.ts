/**
 * A backing track opened for streaming decode (#468): the container is read with mediabunny
 * (MP4/M4A/MOV, WebM/MKV, Ogg, MP3, WAV, ADTS-AAC, FLAC, …) and the audio decoded piece by piece
 * through WebCodecs, from any position - nothing is decoded before it is needed, and a track that
 * is no longer wanted stops decoding at once (`dispose`).
 *
 * `null` from `openTrackStream` means "can't stream this one" (unknown container, or a codec this
 * device's WebCodecs can't decode) - the engine then falls back to decoding the whole file with
 * `decodeAudioData`, which handles everything else the browser can play.
 */
export interface TrackStream {
  durationS: number
  /** Decoded audio from `startS` on, in order. Each piece is contiguous with the previous one. */
  buffers(startS: number): AsyncGenerator<{ buffer: AudioBuffer; timestamp: number }, void, unknown>
  dispose(): void
}

export async function openTrackStream(blob: Blob): Promise<TrackStream | null> {
  if (typeof AudioDecoder === 'undefined') return null
  // Loaded on first use - keeps the container readers out of the app's startup bundle.
  const { ALL_FORMATS, AudioBufferSink, BlobSource, Input } = await import('mediabunny')
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track || !(await track.canDecode())) {
      input.dispose()
      return null
    }
    const durationS = await track.computeDuration()
    const sink = new AudioBufferSink(track)
    return {
      durationS,
      async *buffers(startS) {
        for await (const { buffer, timestamp } of sink.buffers(Math.max(0, startS))) yield { buffer, timestamp }
      },
      dispose: () => input.dispose(),
    }
  } catch {
    input.dispose()
    return null
  }
}
