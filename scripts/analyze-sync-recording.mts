/**
 * Evaluates a recording of the reference song (#464): click against track beep, per beat and per
 * section.
 *
 *   node scripts/analyze-sync-recording.mts <recording.wav> [--track 0] [--click 0] [--csv beats.csv]
 *
 * 16-bit WAV, mono or stereo (e.g. `arecord -f S16_LE -r 48000 -c 2 rec.wav`). With two devices on
 * the two inputs of an interface, `--track` and `--click` pick the channel of each (0 = left,
 * 1 = right); by default both are channel 0. Negative values: the click comes before the beep.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { buildReferenceSong } from '../packages/stage-pwa/src/lib/referenceSong.ts'
import { analyzeSyncRecording, decodeWav, type SyncSectionSummary } from '../packages/stage-pwa/src/lib/syncAnalysis.ts'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a))
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
if (!file) throw new Error('usage: node scripts/analyze-sync-recording.mts <recording.wav> [--track 0] [--click 0] [--csv beats.csv]')

const { rate, channels } = decodeWav(new Uint8Array(readFileSync(file)))
const pick = (name: string) => {
  const c = Number(opt(name) ?? 0)
  if (!channels[c]) throw new Error(`--${name} ${c}: the recording has ${channels.length} channel(s)`)
  return channels[c]!
}
const song = buildReferenceSong()
const report = analyzeSyncRecording(song, pick('track'), pick('click'), rate)

const fmt = (v: number | null, w = 7) => (v === null ? '-' : v.toFixed(1)).padStart(w)
const row = (s: SyncSectionSummary) =>
  `${s.section.padEnd(14)}${String(s.pairs).padStart(4)}/${String(s.beats).padEnd(4)}${fmt(s.medianMs)}${fmt(s.meanMs)}${fmt(s.sdMs)}${fmt(s.minMs)}${fmt(s.maxMs)}${fmt(s.driftMsPerMin, 9)}${String(s.trackJumps).padStart(7)}`
console.log(`${file}: ${channels.length} channel(s), ${rate} Hz, ${(channels[0]!.length / rate).toFixed(1)} s; song time 0 at ${(report.trackStartMs / 1000).toFixed(3)} s`)
console.log('Click minus track (ms; negative = click before the beep)')
console.log(`${'section'.padEnd(14)}${'pairs'.padStart(9)}${'median'.padStart(7)}${'mean'.padStart(7)}${'sd'.padStart(7)}${'min'.padStart(7)}${'max'.padStart(7)}${'ms/min'.padStart(9)}${'jumps'.padStart(7)}`)
for (const s of report.sections) console.log(row(s))
console.log(row(report.overall))
console.log(`Unassigned: ${report.strayTrackOnsets} beep events, ${report.strayClicks} click events (count-in clicks land here)`)

const csv = opt('csv')
if (csv) {
  writeFileSync(csv, ['bar,beat,section,song_ms,track_ms,click_minus_track_ms', ...report.beats.map((b) => [b.bar, b.beat, b.section, b.songMs.toFixed(1), b.trackMs ?? '', b.clickMinusTrackMs ?? ''].join(','))].join('\n') + '\n')
  console.log(`Every beat: ${csv}`)
}
