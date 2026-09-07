import { z } from 'zod'

/** Routes to a Stage-Server-hosted plugin instead of a specific tablet - today's default
 * behavior (before #10 existed at all), now expressed as one reserved `ExecutionTarget` value
 * rather than "this capability has no binding". Also reused as a generic "the server itself"
 * sentinel by Discovery Mode's native-MIDI watcher (core-backend's midiWatcher.ts) - unrelated to
 * Logical Device routing, just the same "this is the Stage-Server, not a tablet" identity. */
export const SERVER_EXECUTION_TARGET = 'server'

/** 'server' (see above) or a specific tablet's `Device.id` (device.ts). */
export const ExecutionTargetSchema = z.string().min(1)
export type ExecutionTarget = z.infer<typeof ExecutionTargetSchema>
