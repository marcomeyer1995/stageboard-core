import { z } from 'zod'

/** Shared by every list/scrolling-content widget (Prompter, Live-Queue, Show-Notizen,
 * System-Status) - `fontSize` unset means "use the device's global default"
 * (useContentFontSizeStore.ts), set means this one instance overrides it. */
export const ContentFontSizeConfigSchema = z.object({
  fontSize: z.number().int().positive().optional(),
})
export type ContentFontSizeConfig = z.infer<typeof ContentFontSizeConfigSchema>
