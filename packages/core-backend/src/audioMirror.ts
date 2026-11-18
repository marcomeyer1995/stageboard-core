import { BandHostsSchema, type BandHostEntry } from 'shared-types'

export interface MirrorTrack {
  variantId: string
  trackId: string
  /** TrackMeta.fileRev: bumped when the stored file is replaced under the same id. Absent = the first file. */
  fileRev?: number
}

export interface MirrorStatus {
  /** Tracks the replicated song variants list. */
  total: number
  /** Of those, how many this host holds in the right revision. */
  present: number
  /** The primary does not have them (404) or the fetch failed - tried again on the next tick. */
  missing: number
}

export interface AudioMirror {
  /** Fetches what is missing from the primary, one file at a time (call every few seconds). Never throws. */
  tick(): Promise<void>
  status(): MirrorStatus | null
}

/**
 * The backup's audio (host backup, #919): to take the show over it needs every track the songs use,
 * but it must not hold things twice or copy whole folders. So it reads which tracks the replicated
 * song variants list and fetches only those it does not have - or has in an older revision (a track
 * converted on a device keeps its id and raises `fileRev`) - from the primary, over a connection
 * pinned to the primary's fingerprint. `GET /audio` needs no login on a host. Only while passive: once
 * it has taken over, the primary is gone. Files it already has are never touched or removed.
 */
export function createAudioMirror(deps: {
  selfHostId: string
  workspaceId: () => string | null
  readHosts: (workspaceId: string) => Promise<readonly BandHostEntry[] | null>
  /** True while this host is the band's backup and has not taken over. */
  passive: () => boolean
  listTracks: (workspaceId: string) => Promise<MirrorTrack[]>
  /** What this host holds of the track: null = no file, else the revision it was saved with (null = none recorded). */
  localRevision: (variantId: string, trackId: string) => Promise<{ rev: number | null } | null>
  /** The file from the primary, or null if it does not have it. */
  fetchFile: (baseUrl: string, fingerprint: string | undefined, variantId: string, trackId: string) => Promise<Buffer | null>
  saveFile: (variantId: string, trackId: string, rev: number | null, data: Buffer) => Promise<void>
}): AudioMirror {
  let status: MirrorStatus | null = null
  let busy = false

  /** Present when a file is here and, if the track names a revision, it was saved with that one. A file with
   * no recorded revision is taken as current for a track that names none. */
  const current = async (track: MirrorTrack): Promise<boolean> => {
    const have = await deps.localRevision(track.variantId, track.trackId)
    if (have === null) return false
    return track.fileRev === undefined ? true : have.rev === track.fileRev
  }

  return {
    async tick() {
      if (busy) return
      busy = true
      try {
        const workspaceId = deps.workspaceId()
        if (!workspaceId || !deps.passive()) return
        const hosts = BandHostsSchema.safeParse(await deps.readHosts(workspaceId))
        const primary = hosts.success && hosts.data.length >= 2 ? hosts.data.find((h) => h.priority === 1) : undefined
        const self = hosts.success ? hosts.data.find((h) => h.hostId === deps.selfHostId) : undefined
        if (!primary || self?.priority !== 2) return

        const tracks = await deps.listTracks(workspaceId)
        const baseUrl = primary.url.replace(/\/+$/, '')
        let present = 0
        let missing = 0
        for (const track of tracks) {
          if (await current(track)) {
            present += 1
            continue
          }
          if (!deps.passive()) break
          try {
            const data = await deps.fetchFile(baseUrl, primary.certFingerprint, track.variantId, track.trackId)
            if (data === null) {
              missing += 1
              continue
            }
            await deps.saveFile(track.variantId, track.trackId, track.fileRev ?? null, data)
            present += 1
          } catch {
            missing += 1
          }
        }
        status = { total: tracks.length, present, missing }
      } catch {
        // The primary or the database not being readable: the next tick tries again.
      } finally {
        busy = false
      }
    },
    status: () => (status ? { ...status } : null),
  }
}
