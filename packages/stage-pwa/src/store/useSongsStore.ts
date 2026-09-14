import { create } from 'zustand'
import type { Song } from 'shared-types'
import {
  getAllSongs,
  putSong,
  seedDummySongsIfEmpty,
  songsChanges,
  switchSongsWorkspace,
  type SongDoc,
} from '../lib/db'
import { duplicateSongAndVariants, removeSongAndVariants } from '../lib/songVariantsDb'

function toSong(doc: SongDoc): Song {
  return {
    id: doc.id,
    title: doc.title,
    // Correctly written by saveSong (it's a plain field on Song), but silently dropped on
    // every read here until now - nothing defaulted it away like timeSignature below, this
    // mapper just never copied it across. Found live: Band appeared to "not save" because the
    // very next refresh (the change feed fires right after every save) read it back as
    // undefined.
    artist: doc.artist,
    bpm: doc.bpm,
    // A song written before `timeSignature` existed (#25) simply lacks the key - see
    // useSongVariantsStore.ts's `toVariant` for the same read-time-fallback reasoning.
    timeSignature: doc.timeSignature ?? '4/4',
    clickTrackEnabled: doc.clickTrackEnabled ?? false,
    chordProContent: doc.chordProContent,
    timecodes: doc.timecodes,
  }
}

interface SongsState {
  songs: Song[]
  loaded: boolean
  init: (workspaceId: string) => Promise<void>
  saveSong: (song: Song) => Promise<void>
  /** Also copies the song's own variants (#178's desktop context menu) - see
   * songVariantsDb.ts's duplicateSongAndVariants for exactly what comes along. */
  duplicateSong: (id: string, newTitle: string) => Promise<Song | null>
  /** Also deletes the song's own variants and their tracks (#105) - see
   * songVariantsDb.ts's removeSongAndVariants for the full cascade. */
  remove: (id: string) => Promise<void>
}

let changesHandle: PouchDB.Core.Changes<Song> | null = null

async function refreshSongs(set: (partial: Partial<SongsState>) => void) {
  const docs = await getAllSongs()
  set({ songs: docs.map(toSong) })
}

/** The song catalog for the active workspace. Playback order/position lives in useShowStateStore. */
export const useSongsStore = create<SongsState>((set, get) => ({
  songs: [],
  loaded: false,
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchSongsWorkspace(workspaceId)
    set({ songs: [], loaded: false })

    await seedDummySongsIfEmpty()
    await refreshSongs(set)
    set({ loaded: true })

    changesHandle = songsChanges({ since: 'now', live: true, include_docs: true })
    changesHandle.on('change', () => refreshSongs(set))
  },
  saveSong: async (song) => {
    await putSong(song)
  },
  duplicateSong: async (id, newTitle) => {
    const source = get().songs.find((song) => song.id === id)
    if (!source) return null
    return duplicateSongAndVariants(source, newTitle)
  },
  remove: async (id) => {
    await removeSongAndVariants(id)
  },
}))
