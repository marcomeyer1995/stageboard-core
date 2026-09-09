/** Parses a "4/4"/"6/8"-style time signature into its beat count. Anything unparseable (an
 * empty string, a doc predating #25, a typo) falls back to 4/4 rather than throwing - a
 * metronome that assumes straight time is a far better failure mode than a crashed widget. */
export function beatsPerBar(timeSignature: string): number {
  const beats = Number.parseInt(timeSignature.split('/')[0] ?? '', 10)
  return Number.isFinite(beats) && beats > 0 ? beats : 4
}

export interface Beat {
  /** 0-indexed position within the bar - 0 is always the downbeat. */
  beatInBar: number
  isDownbeat: boolean
  /** How far into the current beat, in ms - 0 right on the beat, approaching msPerBeat just
   * before the next one. Drives the pulse's decay rather than a hard on/off flash. */
  msIntoBeat: number
}

/**
 * The beat at a given elapsed-ms position into a song, locked to the same synced elapsed time
 * every other timeline consumer uses (usePlaybackElapsedMs.ts) - not a local setInterval, so
 * it stays sample-accurate to the beat across every tablet in the workspace the same way the
 * Prompter's scroll position does (docs/00 §4).
 */
export function beatAt(elapsedMs: number, bpm: number, timeSignature: string): Beat {
  const msPerBeat = 60000 / bpm
  const beatIndex = Math.floor(elapsedMs / msPerBeat)
  const beatInBar = beatIndex % beatsPerBar(timeSignature)
  return {
    beatInBar,
    isDownbeat: beatInBar === 0,
    msIntoBeat: elapsedMs - beatIndex * msPerBeat,
  }
}
