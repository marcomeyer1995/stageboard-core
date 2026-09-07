import { z } from 'zod'

/** One CC message in a trigger sequence - only CC# and value are compared, not channel (still
 * being configured at discovery time). Its own schema (not inlined) because both a plugin's
 * `discoveryTrigger.matchCcSequence` and the live-broadcast `DiscoveryIdentifying.matchCcSequence`
 * (discoverySession.ts) need the exact same shape - every participant (a tablet, or the
 * Stage-Server's own native MIDI watcher) matches incoming messages against it locally. */
export const CcSequenceSchema = z.array(z.object({ cc: z.number().int().min(0).max(127), value: z.number().int().min(0).max(127) })).min(1)
export type CcSequence = z.infer<typeof CcSequenceSchema>

/**
 * A plugin-declared "identify yourself" action for Discovery Mode - when a role can't be
 * resolved unambiguously by catalog metadata alone (two guitarists, two "Kemper Profiler"
 * candidates), the system asks a musician to perform this physical action and binds whichever
 * candidate port actually produces the matching MIDI sequence. Kemper's is the tuner CC toggled
 * on then off (`kemperTranslator.ts`'s `test` action already sends exactly this sequence, so the
 * "Testen" button and a real Discovery trigger are the same wire signal).
 */
export const DiscoveryTriggerSchema = z.object({
  /** Shown to the musician, e.g. "Tuner am Kemper kurz an- und wieder ausschalten." */
  instruction: z.string().min(1),
  matchCcSequence: CcSequenceSchema,
  /** How long a role stays in the "identifying" state waiting for this trigger before Discovery
   * gives up and flags it for manual assignment. */
  timeoutMs: z.number().int().positive().default(15000),
})
export type DiscoveryTrigger = z.infer<typeof DiscoveryTriggerSchema>
