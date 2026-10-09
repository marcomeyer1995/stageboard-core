/**
 * Writes the reference song (#464) to a folder - the two tracks, the ChordPro text and the ground
 * truth of every beat, section, cue and alert:
 *
 *   node scripts/make-reference-song.mts [out-dir]      (default: ./reference-song)
 *
 * Plain Node (24+ runs TypeScript directly); the song itself is lib/referenceSong.ts, the same
 * code the app will use to create it for a band.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildReferenceSong, encodeWav, synthesizeBeeps, synthesizeDrums } from '../packages/stage-pwa/src/lib/referenceSong.ts'

const out = process.argv[2] ?? 'reference-song'
const rate = 44100
const song = buildReferenceSong()
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'beeps.wav'), encodeWav(synthesizeBeeps(song, rate), rate))
writeFileSync(join(out, 'drums.wav'), encodeWav(synthesizeDrums(song, rate), rate))
writeFileSync(join(out, 'song.cho'), song.chordPro + '\n')
const { chordPro: _chordPro, ...truth } = song
writeFileSync(join(out, 'ground-truth.json'), JSON.stringify(truth, null, 2) + '\n')
console.log(
  JSON.stringify({
    out,
    durationS: Math.round(song.durationMs / 100) / 10,
    bars: new Set(song.beats.map((b) => b.bar)).size,
    beats: song.beats.length,
    gridPoints: song.grid.points.length,
    sections: song.sections.map((s) => `${s.name}@${(s.timeMs / 1000).toFixed(2)}s`),
  }),
)
