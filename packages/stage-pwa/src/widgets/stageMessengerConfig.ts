import { z } from 'zod'
import { ContentFontSizeConfigSchema } from './contentFontSizeConfig'

/** Stage-Messenger (#26): text size plus this widget's own quick messages (Marco: editable and
 * in his order) - absent means the built-in list (FLASH_PRESETS). */
export const StageMessengerConfigSchema = ContentFontSizeConfigSchema.extend({
  presets: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
})
export type StageMessengerConfig = z.infer<typeof StageMessengerConfigSchema>
