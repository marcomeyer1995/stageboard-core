import { z } from 'zod'
import { ContentFontSizeConfigSchema } from './contentFontSizeConfig'

/**
 * Every element but the lyrics text itself is sized as a *ratio* of it, not an absolute px
 * value (Marco, 2026-09-14: "einmal zentral ändern und alle Verhältnisse bleiben gleich") -
 * the lyrics text's own resolved size (`fontSize`, inherited from ContentFontSizeConfigSchema
 * - the device-wide "Textgröße" default, or this instance's own override) is the one anchor
 * point. Change that anchor (globally in Settings, or just for this instance) and every
 * ratio below scales with it automatically, no per-element re-tuning needed. Defaults below
 * match what each element looked like before this became configurable.
 */
export const DEFAULT_TITLE_SIZE_RATIO = 2
export const DEFAULT_ARTIST_SIZE_RATIO = 0.9
export const DEFAULT_SECTION_LABEL_SIZE_RATIO = 1.1
export const DEFAULT_CHORD_SIZE_RATIO = 0.7
export const DEFAULT_ARRANGEMENT_INFO_SIZE_RATIO = 0.6

export const PrompterConfigSchema = ContentFontSizeConfigSchema.extend({
  /** Moved out of the widget's own live UI into this config (Marco, 2026-09-14) - toggling
   * view mode is now a "⋯" menu action, not a one-tap control during a show. */
  viewMode: z.enum(['scroll', 'paginated']).default('scroll'),
  chordSizeRatio: z.number().positive().optional(),
  titleSizeRatio: z.number().positive().optional(),
  artistSizeRatio: z.number().positive().optional(),
  sectionLabelSizeRatio: z.number().positive().optional(),
  /** The Key/Tuning/Capo line at the top of the scrolling lyrics content. */
  arrangementInfoSizeRatio: z.number().positive().optional(),
})
export type PrompterConfig = z.infer<typeof PrompterConfigSchema>
