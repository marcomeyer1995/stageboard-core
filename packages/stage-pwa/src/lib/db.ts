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
