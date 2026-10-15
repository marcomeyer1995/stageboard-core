import type { TrackMeta } from 'shared-types'

/**
 * Stems (#9): `kind: 'stem'` tracks split from another track of the variant (`parentTrackId`) by
 * the Stage-Server's stem-separation plugin. They are not alternatives to play as the backing track
 * and aren't downloaded to every device - only listed, heard and renamed under their track.
 */
export function isStem(track: Pick<TrackMeta, 'kind'>): boolean {
  return track.kind === 'stem'
}

/** The tracks that can be the song's backing track - everything but stems. */
export function playableTracks(tracks: readonly TrackMeta[]): TrackMeta[] {
  return tracks.filter((t) => !isStem(t))
}

export function stemsOf(tracks: readonly TrackMeta[], parentTrackId: string): TrackMeta[] {
  return tracks.filter((t) => isStem(t) && t.parentTrackId === parentTrackId)
}
