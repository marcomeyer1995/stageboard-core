import { z } from 'zod'
import { DetectedHardwareSchema } from './hardwareMatching.js'
import { CcSequenceSchema } from './discoveryTrigger.js'

/**
 * One physical port a participant (a tablet, or the Stage-Server's own native MIDI watcher -
 * see `SERVER_EXECUTION_TARGET` in hardwareSetup.ts) currently sees, as reported into a
 * DiscoverySession. `reporterId` is a `Device.id` or `SERVER_EXECUTION_TARGET`; `hardwareKey` is
 * `hardwareMatching.ts`'s `hardwareKeyFor(detected)` - together they're this candidate's unique
 * identity (the same hardwareKey could coincidentally recur on two different reporters).
 */
export const DiscoveryCandidateSchema = z.object({
  reporterId: z.string().min(1),
  hardwareKey: z.string().min(1),
  name: z.string(),
  manufacturer: z.string(),
  /** Which installed plugin's catalog metadata this candidate matched, if any - resolved by the
   * reporter itself via `matchDetectedHardware` before reporting, so the coordinator never needs
   * its own copy of the installed-plugins list per report. */
  matchedPluginId: z.string().nullable(),
  status: z.enum(['unassigned', 'identifying', 'assigned', 'needs-manual']),
  assignedLogicalDeviceId: z.string().nullable(),
})
export type DiscoveryCandidate = z.infer<typeof DiscoveryCandidateSchema>

/** The one role Discovery is currently asking a musician to physically identify (the "resolution
 * model" is sequential, one role at a time - see useDiscoveryTrigger.ts/discoverySessionStore.ts's
 * doc comments for why). */
export const DiscoveryIdentifyingSchema = z.object({
  logicalDeviceId: z.string().min(1),
  logicalDeviceName: z.string().min(1),
  pluginId: z.string().min(1),
  instruction: z.string().min(1),
  /** So every participant (a tablet in useDiscoveryTrigger.ts, or the Stage-Server's own
   * midiWatcher.ts) can match incoming MIDI locally, without needing its own copy of the
   * matched plugin's full manifest. */
  matchCcSequence: CcSequenceSchema,
  deadline: z.number().int().nonnegative(),
})
export type DiscoveryIdentifying = z.infer<typeof DiscoveryIdentifyingSchema>

/**
 * A workspace-wide, admin-initiated hardware-discovery session - deliberately **not** a
 * CouchDB-replicated document (same reasoning as presence/plugin-health: a live coordination
 * session has no offline/multi-master value and shouldn't outlive a server restart). Lives only
 * in the Stage-Server's memory (core-backend's discoverySessionStore.ts) and is broadcast to
 * every connected tablet over SSE, the same pattern presenceStore.ts already uses.
 */
export const DiscoverySessionSchema = z.object({
  active: z.boolean(),
  startedAt: z.number().int().nonnegative().nullable(),
  startedBy: z.string().nullable(),
  candidates: z.array(DiscoveryCandidateSchema),
  identifying: DiscoveryIdentifyingSchema.nullable(),
})
export type DiscoverySession = z.infer<typeof DiscoverySessionSchema>

export const EMPTY_DISCOVERY_SESSION: DiscoverySession = {
  active: false,
  startedAt: null,
  startedBy: null,
  candidates: [],
  identifying: null,
}

/** Request bodies for the `/workspaces/:id/discovery/*` routes (core-backend's index.ts). */
export const DiscoveryStartRequestSchema = z.object({ startedBy: z.string().min(1).nullable().default(null) })
export type DiscoveryStartRequest = z.infer<typeof DiscoveryStartRequestSchema>

export const DiscoveryReportCandidateRequestSchema = z.object({
  reporterId: z.string().min(1),
  detected: DetectedHardwareSchema,
})
export type DiscoveryReportCandidateRequest = z.infer<typeof DiscoveryReportCandidateRequestSchema>

export const DiscoveryTriggeredRequestSchema = z.object({
  reporterId: z.string().min(1),
  hardwareKey: z.string().min(1),
})
export type DiscoveryTriggeredRequest = z.infer<typeof DiscoveryTriggeredRequestSchema>
