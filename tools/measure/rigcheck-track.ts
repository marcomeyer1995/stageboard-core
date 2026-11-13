// Writes the quick Rig-Check track (48 kHz float32) and its beats - the known ground truth for
// measure_out.py selftest. Bundled and run by `measure_out.py selftest` (needs the repo's
// node_modules for esbuild).
import { writeFileSync } from 'node:fs'
import { buildRigCheckSong, synthesizeRigCheckTrack } from '../../packages/stage-pwa/src/lib/rigCheckSong'

const out = process.argv[2]!
const song = buildRigCheckSong('quick')
const track = synthesizeRigCheckTrack(song, 48000)
writeFileSync(`${out}/track.f32`, Buffer.from(track.buffer))
writeFileSync(`${out}/beats.json`, JSON.stringify(song.beats.map((b) => ({ t: b.timeMs, bar: b.bar, beat: b.beat, silent: b.silent }))))
console.log(`${song.beats.length} beats, ${song.durationMs} ms`)
