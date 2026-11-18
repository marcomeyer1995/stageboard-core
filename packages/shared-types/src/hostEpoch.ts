import { z } from 'zod'

/**
 * What `GET /time` answers (host backup, #782 part B, docs/25 §6e). Besides the clock, the host
 * says who it is and which **epoch** it serves under: every takeover by a backup raises the epoch,
 * and a device follows the host with the highest one, so there are never two active hosts.
 */
export const HostTimeSchema = z.object({
  serverTime: z.number(),
  hostId: z.string().min(1),
  epoch: z.number().int().min(1),
  /** This host is the band's host now - false for a passive backup, and for a primary that is out of date
   * (#938). Optional: a host built before it existed says nothing. */
  active: z.boolean().optional(),
})
export type HostTime = z.infer<typeof HostTimeSchema>

/** What a device accepts: a host built before the epoch existed sends the time only. */
export const HostTimeAnswerSchema = HostTimeSchema.partial({ hostId: true, epoch: true })
export type HostTimeAnswer = z.infer<typeof HostTimeAnswerSchema>
