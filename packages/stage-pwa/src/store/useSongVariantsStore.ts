import { coalesced } from '../lib/coalesced'
import type { LocalChangesHandle } from '../lib/localChanges'
import { create } from 'zustand'
import type { SongVariant } from 'shared-types'
import {
  getAllVariants,
  putVariant,
  switchVariantsWorkspace,
  variantsChanges,
  type SongVariantDoc,
} from '../lib/songVariantsDb'

/** A stored variant as the app uses it: every field of the doc (the hand-picked copy it used to
 * be silently dropped each new field - `durationMs` #28, `transpose`/tuning 2026-10-18), with
 * read-time fallbacks for keys older docs lack - PouchDB returns exactly what was stored,
 * unvalidated, so these matter even though the type says they're always present. */
export function toVariant(doc: SongVariantDoc): SongVariant {
  const { _id, _rev, _deleted, _conflicts, ...rest } = doc as SongVariantDoc & { _deleted?: boolean; _conflicts?: string[] }
  void _id
  void _rev
  void _deleted
  void _conflicts
  return {
    ...rest,
    // Before `timeSignature` (#25), `cues` (#99) and the count-in existed.
    timeSignature: rest.timeSignature ?? '4/4',
    clickTrackEnabled: rest.clickTrackEnabled ?? false,
    cues: rest.cues ?? [],
    countInEnabled: rest.countInEnabled ?? false,
    countInBars: rest.countInBars ?? 1,
  }
}

interface SongVariantsState {
  variants: SongVariant[]
  loaded: boolean
  init: (workspaceId: string) => Promise<void>
  saveVariant: (variant: SongVariant) => Promise<void>
}

let changesHandle: LocalChangesHandle<SongVariant> | null = null

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

    changesHandle = variantsChanges()
    changesHandle.on('change', coalesced(() => refreshVariants(set)))
  },
  saveVariant: async (variant) => {
    await putVariant(variant)
  },
}))
