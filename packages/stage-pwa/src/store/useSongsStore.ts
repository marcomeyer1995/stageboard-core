import { create } from 'zustand'
import type { Song } from 'shared-types'
import {
  getAllSongs,
  getSongsDb,
  putSong,
  seedDummySongsIfEmpty,
  switchSongsWorkspace,
  type SongDoc,
} from '../lib/db'

function toSong(doc: SongDoc): Song {
  return {
    id: doc.id,
    title: doc.title,
    bpm: doc.bpm,
    chordProContent: doc.chordProContent,
    timecodes: doc.timecodes,
  }
}

interface SongsState {
  songs: Song[]
  loaded: boolean
  init: (workspaceId: string) => Promise<void>
  saveSong: (song: Song) => Promise<void>
}

let changesHandle: PouchDB.Core.Changes<Song> | null = null

async function refreshSongs(set: (partial: Partial<SongsState>) => void) {
  const docs = await getAllSongs()
  set({ songs: docs.map(toSong) })
}

/** The song catalog for the active workspace. Playback order/position lives in useShowStateStore. */
export const useSongsStore = create<SongsState>((set) => ({
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

    changesHandle = getSongsDb().changes({ since: 'now', live: true, include_docs: true })
    changesHandle.on('change', () => refreshSongs(set))
  },
  saveSong: async (song) => {
    await putSong(song)
  },
}))
