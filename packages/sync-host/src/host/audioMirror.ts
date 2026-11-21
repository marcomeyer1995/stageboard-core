import { BandHostsSchema, type BandHostEntry } from 'shared-types'
import { parseTrackKey, planTrackSync, trackKey, type TrackRef } from './trackSync.js'

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
  listTracks: (workspaceId: string) => Promise<TrackRef[]>
  /** What this host holds, as track keys (`trackKey`): the revision a file was saved with is part of its key. */
  heldKeys: () => Promise<string[]>
  /** The file from the primary, or null if it does not have it. */
  fetchFile: (baseUrl: string, fingerprint: string | undefined, variantId: string, trackId: string) => Promise<Buffer | null>
  saveFile: (variantId: string, trackId: string, rev: number | null, data: Buffer) => Promise<void>
}): AudioMirror {
  let status: MirrorStatus | null = null
  let busy = false

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
        // The rule of what is current is the one every store of tracks uses (sync-host's trackSync): held in the revision the
        // track names, or missing. Nothing is ever removed here - a mirror only adds.
        const plan = planTrackSync(tracks.map((t) => trackKey(t.variantId, t.trackId, t.fileRev)), await deps.heldKeys())
        let present = plan.present
        let missing = 0
        for (const key of plan.fetch) {
          if (!deps.passive()) break
          const track = parseTrackKey(key)
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
