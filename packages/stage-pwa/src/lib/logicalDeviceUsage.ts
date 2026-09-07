import type { Song, SongVariant } from 'shared-types'

export interface LogicalDeviceUsage {
  songId: string
  songTitle: string
  variantLabel: string
}

/**
 * Every song variant that has a cue targeting `logicalDeviceId` (`ShowCue.targetLogicalDeviceId`,
 * #99) - the Hardware Setup Wizard's "already in use by: ..." list (Step 1), so picking a name
 * that collides with an existing, song-referenced Logical Device is an informed choice, not a
 * surprise. Pure and store-free, same reasoning `hardwareRouting.ts`'s own doc comment gives -
 * `useSongVariantsStore`/`useSongsStore` transitively pull in `workspaceDb.ts`'s top-level
 * `new PouchDB(...)`, unavailable under happy-dom for unit tests.
 */
export function findLogicalDeviceUsage(logicalDeviceId: string, variants: SongVariant[], songs: Song[]): LogicalDeviceUsage[] {
  const usage: LogicalDeviceUsage[] = []
  for (const variant of variants) {
    if (!variant.cues.some((cue) => cue.targetLogicalDeviceId === logicalDeviceId)) continue
    const song = songs.find((s) => s.id === variant.songId)
    usage.push({ songId: variant.songId, songTitle: song?.title ?? variant.songId, variantLabel: variant.label })
  }
  return usage
}
