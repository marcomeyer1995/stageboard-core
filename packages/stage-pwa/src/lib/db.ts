import { SongSchema, type Song } from 'shared-types'
import { createWorkspaceCollection, type Doc } from './workspaceCollection'

export type SongDoc = Doc<Song>

const songs = createWorkspaceCollection<Song>('songs')

export const getSongsDb = songs.getDb
export const switchSongsWorkspace = songs.switchWorkspace
export const getAllSongs = songs.getAll
export const putSong = songs.put
export const startSync = songs.startSync

const dummySongs: Song[] = [
  SongSchema.parse({
    id: 'song-1',
    title: 'Sweet Home Chicago',
    bpm: 118,
    chordProContent:
      "[00:00.00] Come on, [E7]baby don't you wanna go\n[00:04.50] Back to the [A7]same old place\n[00:09.00] Sweet Home [E7]Chicago",
    timecodes: [{ timeMs: 0, label: 'Verse 1' }],
  }),
  SongSchema.parse({
    id: 'song-2',
    title: 'Sweet Caroline',
    bpm: 128,
    chordProContent:
      "[00:00.00] Where it [C]began, I can't [F]begin to know when\n[00:05.00] But then I know it's [G]growing strong",
    timecodes: [{ timeMs: 0, label: 'Verse 1' }],
  }),
  SongSchema.parse({
    id: 'song-3',
    title: 'Mustang Sally',
    bpm: 128,
    chordProContent: '[00:00.00] [G]Mustang Sally, [C]guess you better slow your mustang down',
    timecodes: [{ timeMs: 0, label: 'Verse 1' }],
  }),
]

export async function seedDummySongsIfEmpty(): Promise<void> {
  const db = getSongsDb()
  const info = await db.info()
  if (info.doc_count > 0) return
  await db.bulkDocs(dummySongs.map((song) => ({ ...song, _id: song.id })))
}

/**
 * A song's backing track (docs/08 Phase 2, home rehearsal + docs/01 audio-playback) rides as
 * a PouchDB attachment on its own document rather than a field in `Song` - CouchDB replicates
 * it over the same mesh as everything else, with no second transport path, but it stays out
 * of the Zod content schema since it's storage, not song data.
 */
const BACKING_TRACK_ATTACHMENT_ID = 'backing-track'

export async function putBackingTrack(songId: string, file: Blob): Promise<void> {
  const db = getSongsDb()
  const doc = await db.get(songId)
  await db.putAttachment(songId, BACKING_TRACK_ATTACHMENT_ID, doc._rev, file, file.type)
}

export async function removeBackingTrack(songId: string): Promise<void> {
  const db = getSongsDb()
  const doc = await db.get(songId)
  if (!doc._attachments?.[BACKING_TRACK_ATTACHMENT_ID]) return
  await db.removeAttachment(songId, BACKING_TRACK_ATTACHMENT_ID, doc._rev)
}

export async function hasBackingTrack(songId: string): Promise<boolean> {
  const db = getSongsDb()
  const doc = await db.get(songId).catch(() => null)
  return Boolean(doc?._attachments?.[BACKING_TRACK_ATTACHMENT_ID])
}

export async function getBackingTrack(songId: string): Promise<Blob | null> {
  const db = getSongsDb()
  try {
    return (await db.getAttachment(songId, BACKING_TRACK_ATTACHMENT_ID)) as Blob
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null
    throw err
  }
}
