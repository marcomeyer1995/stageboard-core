/**
 * The one AudioContext of this device - the click (clickEngine.ts) and, with the Web Audio track
 * engine (#468), the backing track play on it. Same context = same audio clock and same output
 * path, so click and track can't drift apart or start at different moments on one device.
 */
let context: AudioContext | null = null

export function getSharedAudioContext(): AudioContext {
  if (!context) context = new AudioContext()
  return context
}

/** Who currently needs the output awake ('track', 'click'). */
const holders = new Set<string>()
let keepAlive: { osc: OscillatorNode; gain: GainNode } | null = null
/** 40 Hz at -80 dBFS: far below hearing at any stage volume, but not digital silence. */
const KEEP_ALIVE_HZ = 40
const KEEP_ALIVE_GAIN = 0.0001

/**
 * Keeps this device's audio output awake while `who` may have to sound at any moment. After a few
 * seconds of silence Android puts a Bluetooth output to sleep (and the browser closes its own
 * stream); the next sound first wakes both, and the beginning of the song was lost on the way -
 * on a Fender Mustang Micro Plus the start of "Highway to Hell" was missing, in Gig mode and in the
 * Timeline alike, and complete with this signal running (2026-10-10, #468). The same can happen on
 * wireless in-ear systems and USB adapters that power down when idle.
 */
export function holdAudioOutputAwake(who: string, on: boolean): void {
  if (on) holders.add(who)
  else holders.delete(who)
  if (holders.size > 0 && !keepAlive) {
    const ctx = getSharedAudioContext()
    const osc = ctx.createOscillator()
    osc.frequency.value = KEEP_ALIVE_HZ
    const gain = ctx.createGain()
    gain.gain.value = KEEP_ALIVE_GAIN
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    // Without a user gesture the browser may refuse; the next tap (Play) resumes the context anyway.
    void ctx.resume().catch(() => {})
    keepAlive = { osc, gain }
  } else if (holders.size === 0 && keepAlive) {
    keepAlive.osc.stop()
    keepAlive.gain.disconnect()
    keepAlive = null
  }
}

/** Test-only: forget the context so the next call creates a fresh one. */
export function __resetSharedAudioContextForTests(): void {
  context = null
  holders.clear()
  keepAlive = null
}
