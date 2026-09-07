import { z } from 'zod'

/**
 * Cheap, code-free identity metadata a plugin declares on its PluginInstallation
 * (#106) so a tablet can recognize a newly-connected WebMIDI/WebUSB device without
 * loading the plugin's code - just this catalog entry.
 *
 * WebMIDI ports never expose vendor/product IDs cross-browser, only `manufacturer`/`name`
 * strings, so a `webmidi` entry matches by name instead: `namePattern` absent matches every
 * WebMIDI input (a catch-all, like `generic-webmidi`'s), present is a case-insensitive
 * substring match against the detected port's name/manufacturer - the same "Stage 1" filter
 * real device-detection tooling for this kind of gear commonly recommends, verification (e.g.
 * a protocol round-trip) being a separate, plugin-code concern out of scope here.
 */
export const HardwareIdSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('webmidi'), namePattern: z.string().min(1).optional() }),
  z.object({
    kind: z.literal('webusb'),
    vendorId: z.number().int().nonnegative(),
    productId: z.number().int().nonnegative().optional(),
  }),
])
export type HardwareId = z.infer<typeof HardwareIdSchema>
