import { BUILTIN_ADDONS, createAddonHost, type Log } from './addonHost.js'

/** The `synthesize` of `PiperSpeech` that goes through the sandboxed speech add-on (#964): text, model and pace in, Piper's raw WAV out. */
export function createSpeechAddonSynthesize(voiceOf: (model: string) => string, log?: Log): (text: string, model: string, pace: number) => Promise<Uint8Array> {
  const sandbox = createAddonHost(BUILTIN_ADDONS.speechSynthesis, log)
  return async (text, model, pace) => {
    const outcome = await (await sandbox()).call('speak', { text, voice: voiceOf(model), pace }, { timeoutMs: 30_000 })
    if (!outcome.ok) throw new Error(outcome.message)
    const wav = outcome.files.find((f) => f.key === 'wav')
    if (!wav) throw new Error('The add-on returned no clip')
    return wav.bytes
  }
}
