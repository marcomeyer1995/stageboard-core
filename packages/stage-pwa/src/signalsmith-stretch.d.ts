/** The parts of signalsmith-stretch (no types of its own) that lib/mixStretch.ts uses (#683). */
declare module 'signalsmith-stretch' {
  export interface StretchNode extends AudioWorkletNode {
    schedule(change: { output?: number; active?: boolean; semitones?: number; rate?: number }): Promise<unknown>
    latency(): Promise<number>
    configure(config: { blockMs?: number | null; intervalMs?: number; splitComputation?: boolean; preset?: 'default' | 'cheaper' }): Promise<unknown>
  }
  export default function SignalsmithStretch(context: BaseAudioContext, options?: AudioWorkletNodeOptions): Promise<StretchNode>
}
