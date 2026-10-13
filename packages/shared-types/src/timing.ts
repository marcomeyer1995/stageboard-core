import { z } from 'zod'
import { CapabilityIdSchema } from './capability.js'

/**
 * How precisely a capability's output must land on the song time (docs/21 §2). Fixed by the
 * plugin, per capability - not per band (Marco, 2026-10-13):
 *
 * - `sample`   - click, backing track, MIDI clock: sample-exact on the audio clock, compensated.
 * - `realtime` - DMX light, video, effect switching on the beat: scheduled send, latency
 *                compensated, calibration recommended.
 * - `soft`     - in-ear mixer levels, mixer scenes: scheduled send, a few tens of ms don't matter.
 * - `none`     - presets before a song, status: as soon as possible.
 */
export const TimingClassSchema = z.enum(['sample', 'realtime', 'soft', 'none'])
export type TimingClass = z.infer<typeof TimingClassSchema>

/** What each class tolerates between the due moment and the moment the output really happens -
 * the yardstick for the soundcheck check, the Nachbericht and the Sync-Check (docs/21 §5). */
export const TIMING_CLASS_TOLERANCE_MS: Record<TimingClass, number | null> = {
  sample: 2,
  realtime: 10,
  soft: 100,
  none: null,
}

/** What a calibration sensor can detect (docs/21 §4). The sensor itself is a plugin too; which
 * hardware (audio input on the Stage-Server, a microcontroller box, a tablet) is open. */
export const SensorKindSchema = z.enum(['light', 'sound', 'midi-loopback', 'video'])
export type SensorKind = z.infer<typeof SensorKindSchema>

/**
 * A capability's timing declaration in its plugin's manifest (docs/21 §6).
 */
export const CapabilityTimingSchema = z.object({
  capability: CapabilityIdSchema,
  timingClass: TimingClassSchema,
  /** The client Translator sends at the event's `scheduledAt` itself (a WebMIDI timestamp, #477).
   * False: it acts on receipt, so the core waits for the moment before calling it. A Stage-Server
   * plugin needs no flag - the gateway always holds an event until `scheduledAt`. */
  honoursScheduledAt: z.boolean().default(false),
  /** Known delay from the send to the real output (lamp lit, sound out), before any calibration -
   * the core sends this much earlier. Absent: unknown, treated as 0. */
  defaultLatencyMs: z.number().nonnegative().optional(),
  /** How this output can be calibrated: the event that produces a detectable stimulus (full
   * white, a test tone, a MIDI note), and which sensor kinds can see it. Absent: not calibratable. */
  calibration: z
    .object({
      stimulus: z.object({ type: z.string().min(1), payload: z.record(z.string(), z.unknown()).optional() }),
      /** Undoes the stimulus (light back off) - absent when the stimulus is momentary. */
      reset: z.object({ type: z.string().min(1), payload: z.record(z.string(), z.unknown()).optional() }).optional(),
      detectableBy: z.array(SensorKindSchema).min(1),
    })
    .optional(),
})
export type CapabilityTiming = z.infer<typeof CapabilityTimingSchema>

/**
 * A measured (or entered) latency for one output route - a Logical Device driven from one
 * device/transport (docs/21 §3). Where it is stored is part of the calibration work (#491); the
 * shape is fixed here so plugins, the calibration run and the scheduler agree on it.
 */
export const LatencyProfileSchema = z.object({
  latencyMs: z.number(),
  jitterMs: z.number().nonnegative().optional(),
  source: z.enum(['plugin-default', 'measured', 'manual']),
  measuredAt: z.number().int().nonnegative().optional(),
  sensor: SensorKindSchema.optional(),
  samples: z.number().int().positive().optional(),
})
export type LatencyProfile = z.infer<typeof LatencyProfileSchema>

/** Which output a device's audio currently goes to - latency differs a lot between them (docs/21
 * §8.4: speaker vs. Bluetooth adds 150-250 ms). Detected by the native app (Android AudioManager);
 * a browser can't tell and reports `unknown`. */
export const AudioRouteSchema = z.enum(['speaker', 'wired', 'bluetooth', 'usb', 'unknown'])
export type AudioRoute = z.infer<typeof AudioRouteSchema>

/** The `output` of a profile for a device's own audio (click, backing track) - every other output
 * is a Logical Device id. */
export const AUDIO_OUTPUT = 'audio'

/**
 * A stored latency profile for one output path (docs/21 §3, #491): `deviceId` drives `output`
 * (a Logical Device id, or AUDIO_OUTPUT for its own audio) over `route` (audio only; null for
 * everything else). `deviceId` is `server` for outputs the Stage-Server drives. Replicates
 * band-wide so the Geräte tab shows every device's values; the scheduler of the device that
 * drives the output uses it.
 */
export const LatencyProfileDocSchema = LatencyProfileSchema.extend({
  id: z.string().min(1),
  deviceId: z.string().min(1),
  output: z.string().min(1),
  route: AudioRouteSchema.nullable(),
})
export type LatencyProfileDoc = z.infer<typeof LatencyProfileDocSchema>

export function latencyProfileId(deviceId: string, output: string, route: AudioRoute | null): string {
  return `${deviceId}:${output}:${route ?? '-'}`
}
