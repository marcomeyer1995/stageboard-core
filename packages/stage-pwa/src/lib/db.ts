import PouchDB from 'pouchdb-browser'
import { SongSchema, type Song } from 'shared-types'

export const songsDb = new PouchDB<Song>('stageboard-songs')

export type SongDoc = Song & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta

export async function getAllSongs(): Promise<SongDoc[]> {
  const result = await songsDb.allDocs({ include_docs: true })
  return result.rows
    .map((row) => row.doc)
    .filter((doc): doc is SongDoc => doc !== undefined)
}

export async function putSong(song: Song): Promise<void> {
  const existing = await songsDb.get(song.id).catch(() => null)
  const doc: PouchDB.Core.PutDocument<Song> = existing
    ? { ...song, _id: song.id, _rev: existing._rev }
    : { ...song, _id: song.id }
  await songsDb.put(doc)
}

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
  const info = await songsDb.info()
  if (info.doc_count > 0) return
  await songsDb.bulkDocs(dummySongs.map((song) => ({ ...song, _id: song.id })))
}

/** Starts live, bidirectional sync with the Stage-Server's CouchDB, if VITE_COUCHDB_URL is set. */
export function startSync(): PouchDB.Replication.Sync<Song> | null {
  const remoteUrl = import.meta.env.VITE_COUCHDB_URL as string | undefined
  if (!remoteUrl) return null

  const remoteDb = new PouchDB<Song>(remoteUrl, {
    auth: {
      username: import.meta.env.VITE_COUCHDB_USER as string,
      password: import.meta.env.VITE_COUCHDB_PASSWORD as string,
    },
  })

  return songsDb.sync(remoteDb, { live: true, retry: true })
}
