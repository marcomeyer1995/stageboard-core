import { z } from 'zod'

export const TimecodeMarkerSchema = z.object({
  timeMs: z.number().int().nonnegative(),
  label: z.string().min(1),
})
export type TimecodeMarker = z.infer<typeof TimecodeMarkerSchema>

export const SongSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  bpm: z.number().positive(),
  chordProContent: z.string(),
  timecodes: z.array(TimecodeMarkerSchema).default([]),
})
export type Song = z.infer<typeof SongSchema>
