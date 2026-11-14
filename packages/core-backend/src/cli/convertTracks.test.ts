import { describe, expect, it } from 'vitest'
import { OPUS_MIME, convertedTrack, isOggOpus, planStep, tracksOf, type TrackRef } from './convertTracks.js'

const ref = (over: Partial<TrackRef> = {}): TrackRef => ({ db: 'stageboard-b', docId: 'song-variants:v1', variantId: 'v1', trackId: 't1', label: 'Backing', mimeType: 'audio/mpeg', archived: false, ...over })

describe('convertTracks', () => {
  it('lists every track of every variant with its place', () => {
    const refs = tracksOf('stageboard-b', [{ _id: 'song-variants:v1', tracks: [{ id: 't1', label: 'Backing', mimeType: 'audio/mpeg' }, { id: 't2', mimeType: OPUS_MIME, fileRev: 1, archive: { mimeType: 'audio/mp4', sizeBytes: 9 } }] }])
    expect(refs).toEqual([ref(), ref({ trackId: 't2', label: 't2', mimeType: OPUS_MIME, fileRev: 1, archived: true })])
  })

  it('converts what is not Opus yet, skips what is done or has no file, resumes a run stopped after the file was replaced', () => {
    expect(planStep(ref(), { exists: true, isOpus: false }, false).kind).toBe('convert')
    expect(planStep(ref(), { exists: false, isOpus: false }, false).kind).toBe('no-file')
    expect(planStep(ref({ mimeType: OPUS_MIME, archived: true }), { exists: true, isOpus: true }, true).kind).toBe('done')
    expect(planStep(ref(), { exists: true, isOpus: true }, true).kind).toBe('metadata-only')
    // Opus without an archived original (uploaded as Opus): converted like any other - the source is kept first.
    expect(planStep(ref({ mimeType: 'audio/webm' }), { exists: true, isOpus: true }, false).kind).toBe('convert')
  })

  it('new metadata: Opus, size and length of the new file, the original in `archive`, the next fileRev', () => {
    const track = { id: 't1', label: 'Backing', mimeType: 'audio/mpeg', sizeBytes: 9_000_000, durationMs: 247_700 }
    expect(convertedTrack(track, { sizeBytes: 4_900_000, durationMs: 247_734 }, { mimeType: 'audio/mpeg', sizeBytes: 9_000_000 })).toEqual({
      id: 't1',
      label: 'Backing',
      mimeType: OPUS_MIME,
      sizeBytes: 4_900_000,
      durationMs: 247_734,
      fileRev: 1,
      archive: { mimeType: 'audio/mpeg', sizeBytes: 9_000_000 },
    })
    expect(convertedTrack({ ...track, fileRev: 2 }, { sizeBytes: 1, durationMs: 1 }, { mimeType: 'audio/mpeg', sizeBytes: 9 }).fileRev).toBe(3)
  })

  it('recognises Ogg Opus by its first page', () => {
    const head = Buffer.alloc(64)
    head.write('OggS', 0, 'latin1')
    head.write('OpusHead', 28, 'latin1')
    expect(isOggOpus(head)).toBe(true)
    expect(isOggOpus(Buffer.from('ID3\u0004\u0000'))).toBe(false)
  })
})
