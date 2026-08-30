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
    chordProContent: doc.chordProContent,
    timecodes: doc.timecodes,
    tracks: doc.tracks,
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
