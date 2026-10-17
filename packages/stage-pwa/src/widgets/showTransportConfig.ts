import { z } from 'zod'

/** Roughly matches each element's previous typical auto-fit size at the device default. */
export const DEFAULT_TITLE_SIZE_RATIO = 1.8
export const DEFAULT_BUTTONS_SIZE_RATIO = 1.2

export const ShowTransportConfigSchema = z.object({
  titleSizeRatio: z.number().positive().optional(),
  buttonsSizeRatio: z.number().positive().optional(),
})
export type ShowTransportConfig = z.infer<typeof ShowTransportConfigSchema>
