import { z } from 'zod'

/**
 * What "Geprobt" in the Bibliothek counts (Marco, 2026-10-07): Gig-mode plays of the band either
 * in the last `days` days or in the last `shows` shows. Band-wide - every member sees the same.
 */
export const RehearsalWindowSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('days'), days: z.number().int().positive() }),
  z.object({ kind: z.literal('shows'), shows: z.number().int().positive() }),
])
export type RehearsalWindow = z.infer<typeof RehearsalWindowSchema>

export const DEFAULT_REHEARSAL_WINDOW: RehearsalWindow = { kind: 'days', days: 90 }

/** Ready-made texts for "+ Kommentar" in the song editor (#608) - the band's own, managed in
 * System → Band. Until the band changes them, these defaults are offered. */
export const DEFAULT_COMMENT_TEMPLATES: readonly string[] = ['A cappella', 'Build-up', 'Solo 8 Takte', 'Auf Drummer achten']

/** Settings that apply to the whole band - one document (id "band"); only admins may change it. */
export const BandSettingsSchema = z.object({
  id: z.literal('band'),
  rehearsalWindow: RehearsalWindowSchema.optional(),
  commentTemplates: z.array(z.string().min(1)).optional(),
  /** What each device gets at the Rig-Check's cue times (#464, docs/24 §3): one ready-made command
   * per device; a device without one is left alone. */
  rigCheckCues: z
    .array(z.object({ targetLogicalDeviceId: z.string().min(1), type: z.string().min(1), payload: z.record(z.string(), z.unknown()) }))
    .optional(),
})
export type BandSettings = z.infer<typeof BandSettingsSchema>
