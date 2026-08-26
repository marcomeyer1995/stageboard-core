import { z } from 'zod'

/**
 * One entry in a band's roster. Replicated band-wide like Dashboard/Setlist - who's in
 * the band and what they play is shared knowledge, not private. Picking which profile a
 * given tablet is currently "signed in" as is a separate, device-local choice (see
 * useActiveProfileStore) and is not authentication: any device can pick any profile,
 * same trust level as the existing workspace switcher.
 */
export const ProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Open string, same philosophy as CapabilityId - bands name their own roles. */
  role: z.string().min(1),
})
export type Profile = z.infer<typeof ProfileSchema>
