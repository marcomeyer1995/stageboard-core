import { create } from 'zustand'
import type { SongVariant } from 'shared-types'
import {
  getAllVariants,
  putVariant,
  switchVariantsWorkspace,
  variantsChanges,
  type SongVariantDoc,
} from '../lib/songVariantsDb'

function toVariant(doc: SongVariantDoc): SongVariant {
  return {
    id: doc.id,
    songId: doc.songId,
    label: doc.label,
    isDefault: doc.isDefault,
    bpm: doc.bpm,
    // A variant written before `timeSignature` existed (#25) simply lacks the key - PouchDB
    // returns exactly what was stored, unvalidated, so this read-time fallback matters even
    // though the type says it's always present (same spirit as `cues` below).
    timeSignature: doc.timeSignature ?? '4/4',
    chordProContent: doc.chordProContent,
    timecodes: doc.timecodes,
    tracks: doc.tracks,
    // A variant written before `cues` existed (#99) simply lacks the key - PouchDB returns
    // exactly what was stored, unvalidated, so this read-time fallback matters even though the
    // type says it's always present (same spirit as useSetlistsStore's `toSetlist` fallback).
    cues: doc.cues ?? [],
  }
}

interface SongVariantsState {
  variants: SongVariant[]
  loaded: boolean
  init: (workspaceId: string) => Promise<void>
  saveVariant: (variant: SongVariant) => Promise<void>
}

let changesHandle: PouchDB.Core.Changes<SongVariant> | null = null

async function refreshVariants(set: (partial: Partial<SongVariantsState>) => void) {
  const docs = await getAllVariants()
  set({ variants: docs.map(toVariant) })
}

/** Every variant across the workspace's whole song catalog - components filter by songId. */
export const useSongVariantsStore = create<SongVariantsState>((set) => ({
  variants: [],
  loaded: false,
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchVariantsWorkspace(workspaceId)
    set({ variants: [], loaded: false })

    await refreshVariants(set)
    set({ loaded: true })

    changesHandle = variantsChanges({ since: 'now', live: true, include_docs: true })
    changesHandle.on('change', () => refreshVariants(set))
  },
  saveVariant: async (variant) => {
    await putVariant(variant)
  },
}))
