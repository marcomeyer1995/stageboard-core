import { create } from 'zustand'
import type { Song } from 'shared-types'
import { getAllSongs, putSong, seedDummySongsIfEmpty, songsDb, type SongDoc } from '../lib/db'

function toSong(doc: SongDoc): Song {
  return {
    id: doc.id,
    title: doc.title,
    bpm: doc.bpm,
    chordProContent: doc.chordProContent,
    timecodes: doc.timecodes,
  }
}

function deriveActive(songs: Song[], activeSongId: string | null) {
  if (songs.length === 0) return { currentSong: null, nextSong: null }
  const index = Math.max(
    0,
    songs.findIndex((song) => song.id === activeSongId),
  )
  return {
    currentSong: songs[index] ?? songs[0],
    nextSong: songs[index + 1] ?? null,
  }
}

interface SongsState {
  songs: Song[]
  activeSongId: string | null
  loaded: boolean
  currentSong: Song | null
  nextSong: Song | null
  init: () => Promise<void>
  saveSong: (song: Song) => Promise<void>
  advanceToNextSong: () => void
  setActiveSong: (id: string) => void
}

async function refreshSongs(
  set: (partial: Partial<SongsState>) => void,
  activeSongId: string | null,
) {
  const docs = await getAllSongs()
  const songs = docs.map(toSong)
  const resolvedActiveId = activeSongId ?? songs[0]?.id ?? null
  set({ songs, activeSongId: resolvedActiveId, ...deriveActive(songs, resolvedActiveId) })
}

export const useSongsStore = create<SongsState>((set, get) => ({
  songs: [],
  activeSongId: null,
  loaded: false,
  currentSong: null,
  nextSong: null,
  init: async () => {
    await seedDummySongsIfEmpty()
    await refreshSongs(set, get().activeSongId)
    set({ loaded: true })

    songsDb.changes({ since: 'now', live: true, include_docs: true }).on('change', () => {
      refreshSongs(set, get().activeSongId)
    })
  },
  saveSong: async (song) => {
    await putSong(song)
  },
  advanceToNextSong: () => {
    const { songs, activeSongId } = get()
    const index = songs.findIndex((song) => song.id === activeSongId)
    const next = songs[index + 1]
    if (!next) return
    set({ activeSongId: next.id, ...deriveActive(songs, next.id) })
  },
  setActiveSong: (id) => {
    const { songs } = get()
    set({ activeSongId: id, ...deriveActive(songs, id) })
  },
}))
