/** `music-tempo` ships no TypeScript types of its own - just enough of its real shape for
 * musicTempoAnalysis.ts's own use (the "Beatroot" algorithm's tempo + beat-position output;
 * see https://github.com/scaperoth/musicTempo). */
declare module 'music-tempo' {
  export default class MusicTempo {
    constructor(audioData: Float32Array, params?: Record<string, unknown>)
    /** BPM as a string (music-tempo's own quirk - parse with Number()/parseFloat()). */
    tempo: string | number
    /** Detected beat positions, in seconds from the start of `audioData`. */
    beats: number[]
  }
}
