import { useState } from 'react'
import { DEFAULT_JUMP_CROSSFADE_MS, JUMP_CROSSFADE_RANGE_MS, jumpCrossfadeMs, setJumpCrossfadeMs } from '../lib/webAudioTrackEngine'
import { Stepper } from './ui'

/**
 * How long the backing track crossfades at a section jump or loop pass (#479) - on this device,
 * the one playing the track (Marco, 2026-10-17: to try different lengths). Takes effect at the next
 * jump.
 */
export function JumpCrossfadeSetting() {
  const [ms, setMs] = useState(jumpCrossfadeMs)
  return (
    <div className="flex flex-col gap-1">
      <Stepper
        label="Übergang beim Springen"
        info={`Überblendung des Backing-Tracks an der Sprung- oder Wiederholungsstelle, auf diesem Gerät. Länger klingt weicher, kürzer knackiger. Standard ${DEFAULT_JUMP_CROSSFADE_MS} ms.`}
        value={ms}
        unit="ms"
        min={JUMP_CROSSFADE_RANGE_MS.min}
        max={JUMP_CROSSFADE_RANGE_MS.max}
        step={JUMP_CROSSFADE_RANGE_MS.step}
        onChange={(next) => {
          setJumpCrossfadeMs(next)
          setMs(next)
        }}
      />
      <p className="text-sm text-ink-faint">Wirkt beim nächsten Sprung.</p>
    </div>
  )
}
