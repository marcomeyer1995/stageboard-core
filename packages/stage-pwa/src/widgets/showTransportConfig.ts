import { z } from 'zod'

/** Roughly matches each element's previous typical auto-fit size at the device default. */
export const DEFAULT_TITLE_SIZE_RATIO = 1.8
export const DEFAULT_BUTTONS_SIZE_RATIO = 1.2

export const ShowTransportConfigSchema = z.object({
  titleSizeRatio: z.number().positive().optional(),
  buttonsSizeRatio: z.number().positive().optional(),
  /** Song title beside the clock; off = only the running time (Marco, 2026-10-17: the title stood
   * four times on one dashboard - the status bar already has it). Unset = shown. */
  showTitle: z.boolean().optional(),
})
export type ShowTransportConfig = z.infer<typeof ShowTransportConfigSchema>
