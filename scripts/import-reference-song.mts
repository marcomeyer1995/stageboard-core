/**
 * Puts the reference song (#464) into a band - song, variant (grid, count-in, prompter lines) and
 * its two tracks, "Beeps" (default, for measuring) and "Drums":
 *
 *   set -a; . ~/.config/stageboard/couchdb.env; set +a
 *   NODE_EXTRA_CA_CERTS=certs/dev-cert.pem node scripts/import-reference-song.mts <bandId> https://<server-ip>
 *
 * (The extra CA trusts the Stage-Server's own certificate for the audio upload.)
 *
 * Fixed ids, so running it again updates the same song instead of adding a second one. The docs
 * are checked against the app's own schemas before they are written. Runs on the Stage-Server
 * (CouchDB on localhost, as the backend sees it).
 */
import { SongSchema, SongVariantSchema } from 'shared-types'
import { buildReferenceSong, encodeWav, synthesizeBeeps, synthesizeDrums } from '../packages/stage-pwa/src/lib/referenceSong.ts'

const [bandId, serverUrl = 'https://localhost'] = process.argv.slice(2) as [string | undefined, string | undefined]
if (!bandId) throw new Error('usage: node scripts/import-reference-song.mts <bandId> [serverUrl]')
const couch = (process.env.COUCHDB_URL ?? 'http://127.0.0.1:5984').replace(/\/$/, '')
const auth = 'Basic ' + Buffer.from(`${process.env.COUCHDB_USER ?? 'admin'}:${process.env.COUCHDB_PASSWORD ?? 'admin'}`).toString('base64')
const db = `${couch}/stageboard-${bandId}`

export const REFERENCE_IDS = {
  song: 'f1a7c0de-0464-4000-8000-000000000001',
  variant: 'f1a7c0de-0464-4000-8000-000000000002',
  beeps: 'f1a7c0de-0464-4000-8000-000000000003',
  drums: 'f1a7c0de-0464-4000-8000-000000000004',
}

async function put(id: string, doc: Record<string, unknown>) {
  const url = `${db}/${encodeURIComponent(id)}`
  const existing = await fetch(url, { headers: { Authorization: auth } })
  const rev = existing.ok ? ((await existing.json()) as { _rev: string })._rev : undefined
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...doc, _id: id, ...(rev ? { _rev: rev } : {}) }),
  })
  if (!res.ok) throw new Error(`PUT ${id}: HTTP ${res.status} ${await res.text()}`)
}

const rate = 44100
const song = buildReferenceSong()
const files = { [REFERENCE_IDS.beeps]: encodeWav(synthesizeBeeps(song, rate), rate), [REFERENCE_IDS.drums]: encodeWav(synthesizeDrums(song, rate), rate) }
const now = Date.now()
const track = (id: string, label: string, kind: 'band-mix' | 'reference') => ({
  id,
  kind,
  label,
  source: 'upload' as const,
  parentTrackId: null,
  mimeType: 'audio/wav',
  addedAt: now,
  sizeBytes: files[id]!.length,
  durationMs: song.durationMs,
})

const songDoc = SongSchema.parse({
  id: REFERENCE_IDS.song,
  title: song.title,
  artist: 'StageBoard (#464)',
  bpm: song.bpm,
  timeSignature: song.timeSignature,
  clickTrackEnabled: true,
  chordProContent: song.chordPro,
  timecodes: [],
})
const variantDoc = SongVariantSchema.parse({
  id: REFERENCE_IDS.variant,
  songId: REFERENCE_IDS.song,
  label: 'Original',
  isDefault: true,
  bpm: song.bpm,
  timeSignature: song.timeSignature,
  clickTrackEnabled: true,
  chordProContent: song.chordPro,
  timecodes: [],
  // The first band-mix plays by default (track-override): the beeps, for measuring.
  tracks: [track(REFERENCE_IDS.beeps, 'Beeps (Messung)', 'band-mix'), track(REFERENCE_IDS.drums, 'Drums', 'reference')],
  cues: [],
  beatGrid: song.grid,
  countInEnabled: true,
  countInBars: 1,
})

// Audio first: a variant that names tracks the server doesn't have yet would fail on the tablets.
for (const [trackId, bytes] of Object.entries(files)) {
  const res = await fetch(`${serverUrl}/audio/${REFERENCE_IDS.variant}/${trackId}`, { method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body: bytes })
  if (res.status !== 204) throw new Error(`audio ${trackId}: HTTP ${res.status}`)
}
await put(`songs:${REFERENCE_IDS.song}`, songDoc)
await put(`song-variants:${REFERENCE_IDS.variant}`, variantDoc)
console.log(JSON.stringify({ band: bandId, song: songDoc.title, variant: REFERENCE_IDS.variant, tracks: Object.keys(files).length, gridPoints: song.grid.points.length, durationS: song.durationMs / 1000 }))
