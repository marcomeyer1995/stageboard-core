import { z } from 'zod'
import { ContentFontSizeConfigSchema } from './contentFontSizeConfig'

/** Stage-Messenger (#26): text size plus this widget's own quick messages (Marco: editable and
 * in his order) - absent means the built-in list (FLASH_PRESETS). */
export const StageMessengerConfigSchema = ContentFontSizeConfigSchema.extend({
  // An empty entry is allowed while it is being retyped - with min(1) the whole config failed to
  // parse and fell back to the defaults, losing every custom message (#400 review). The widget
  // shows only non-empty ones; leaving the field drops empty ones.
  presets: z.array(z.string().max(120)).max(30).optional(),
})
export type StageMessengerConfig = z.infer<typeof StageMessengerConfigSchema>
