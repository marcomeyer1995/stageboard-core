import { sharedAddonMethods, type AddonMethods } from './addonMethods.js'

/** The `synthesize` of `PiperSpeech` that goes through the sandboxed speech add-on (#964): text, model and pace in, Piper's raw WAV out. */
export function createSpeechAddonSynthesize(voiceOf: (model: string) => string, methods: AddonMethods = sharedAddonMethods()): (text: string, model: string, pace: number) => Promise<Uint8Array> {
  return async (text, model, pace) => {
    const answer = await methods.call('piper-speech', 'speak', { text, voice: voiceOf(model), pace })
    if (!answer.ok) throw new Error(answer.error.message)
    return (answer.body as { wav: Uint8Array }).wav
  }
}
