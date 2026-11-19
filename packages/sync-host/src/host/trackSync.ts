/** An id becomes part of a storage key, so no separators or control characters (the Stage-Server's rule). */
const isSafeAudioId = (id: string): boolean => /^[a-zA-Z0-9-]+$/.test(id)

/**
 * Which audio tracks a store holds and which it should (host module, #949, #954): the rule every store of
 * tracks follows - a tablet's playback cache, the laptop's audio folder, a backup's mirror - written once.
 * A track is named by a **key**: variant, track and, once the file was replaced under the same id, its
 * revision (`variant:track@3`). A file held under another revision, or under none while the track now names
 * one, is not the file that is wanted. What each side *wants* differs (a device by its sync mode, a backup
 * everything the songs list) and so does what it does with the rest (a device evicts, a mirror never
 * removes) - this module only turns "wanted" and "held" into a plan.
 *
 * Pure: no storage, no network, no Node API.
 */

export interface TrackRef {
  variantId: string
  trackId: string
  /** `TrackMeta.fileRev`: bumped when the stored file is replaced under the same id. Absent = the first file. */
  fileRev?: number
}

export function trackKey(variantId: string, trackId: string, fileRev?: number): string {
  return fileRev ? `${variantId}:${trackId}@${fileRev}` : `${variantId}:${trackId}`
}

export function parseTrackKey(key: string): TrackRef {
  const [variantId = '', rest = ''] = key.split(':')
  const [trackId = '', rev] = rest.split('@')
  const fileRev = Number(rev)
  return { variantId, trackId, ...(Number.isInteger(fileRev) && fileRev > 0 ? { fileRev } : {}) }
}

/** The tracks the song-variant documents list; ids that could leave a storage folder are dropped. */
export function tracksOfVariantDocs(docs: readonly Record<string, unknown>[]): TrackRef[] {
  const out: TrackRef[] = []
  for (const doc of docs) {
    if (typeof doc._id !== 'string' || !doc._id.startsWith('song-variants:') || typeof doc.id !== 'string' || !isSafeAudioId(doc.id)) continue
    for (const track of Array.isArray(doc.tracks) ? (doc.tracks as Record<string, unknown>[]) : []) {
      if (typeof track?.id !== 'string' || !isSafeAudioId(track.id)) continue
      out.push({ variantId: doc.id, trackId: track.id, fileRev: typeof track.fileRev === 'number' ? track.fileRev : undefined })
    }
  }
  return out
}

export interface TrackSyncPlan {
  /** Wanted and not held (in that revision). */
  fetch: string[]
  /** Held and not wanted - only listed when the caller evicts. */
  evict: string[]
  /** Wanted and held. */
  present: number
}

export function planTrackSync(wanted: Iterable<string>, held: Iterable<string>, options: { evict?: boolean } = {}): TrackSyncPlan {
  const want = new Set(wanted)
  const have = new Set(held)
  const fetch = [...want].filter((key) => !have.has(key))
  const evict = options.evict ? [...have].filter((key) => !want.has(key)) : []
  return { fetch, evict, present: want.size - fetch.length }
}
