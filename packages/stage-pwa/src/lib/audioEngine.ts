import type { SessionMode } from '../store/useAppModeStore'

export type AudioEngine = 'plugin' | 'local-mine' | 'local-other' | 'none'

/**
 * Which engine is actually responsible for producing sound on this device - #10's first slice
 * (AudioOutputControl.tsx) lets a specific tablet be claimed as tonight's live audio output,
 * bypassing the Stage-Server plugin entirely; Practice mode always plays locally regardless of
 * any Gig-mode claim (it's a wholly separate, per-device echo - see usePracticeStateStore.ts).
 *
 * Deliberately its own dependency-free module (just the `SessionMode` type) rather than living
 * in showMode.ts: that file transitively imports the PouchDB-backed stores, which crashes in a
 * plain unit test environment (no adapter registered) the moment it's imported at all - this
 * pure decision needs to be importable without dragging that in.
 *
 * - `'plugin'`: Gig mode, no device claimed, and a Stage-Server plugin is reachable.
 * - `'local-mine'`: Practice mode, or Gig mode with *this* device claimed as the output.
 * - `'local-other'`: Gig mode with a *different* device claimed - not this device's job.
 * - `'none'`: Gig mode, no device claimed, and no plugin reachable either.
 */
export function resolveAudioEngine(
  mode: SessionMode,
  audioOutputDeviceId: string | null,
  deviceId: string,
  pluginId: string | null,
): AudioEngine {
  if (mode === 'practice') return 'local-mine'
  if (audioOutputDeviceId === null) return pluginId ? 'plugin' : 'none'
  return audioOutputDeviceId === deviceId ? 'local-mine' : 'local-other'
}
