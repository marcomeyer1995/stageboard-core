import { z } from 'zod'

/** 100% - this instance renders at exactly the device-wide default until its own slider is
 * touched. */
export const DEFAULT_SIZE_RATIO = 1

/** Shared by every list/scrolling-content widget (Prompter, Live-Queue, Show-Notizen,
 * System-Status) - `sizeRatio` unset means "use the device's global default"
 * (useContentFontSizeStore.ts) exactly; set means this one instance's text renders at that
 * ratio of it. A *ratio*, not an absolute px override (Marco, 2026-09-15: an absolute
 * override on this anchor used to detach a touched instance from the central default -
 * every other size slider in the app, including this one's own siblings on Prompter, is
 * already relative to the default, so this was the one inconsistent exception), so tuning
 * the central "Textgröße" setting always rescales every instance together, touched or not -
 * same "einmal zentral ändern und alle Verhältnisse bleiben gleich" guarantee
 * prompterConfig.ts's other ratios already give. */
export const ContentFontSizeConfigSchema = z.object({
  sizeRatio: z.number().positive().optional(),
})
export type ContentFontSizeConfig = z.infer<typeof ContentFontSizeConfigSchema>
