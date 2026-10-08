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

/** Settings that apply to the whole band - one document (id "band"); only admins may change it. */
export const BandSettingsSchema = z.object({
  id: z.literal('band'),
  rehearsalWindow: RehearsalWindowSchema.optional(),
})
export type BandSettings = z.infer<typeof BandSettingsSchema>
