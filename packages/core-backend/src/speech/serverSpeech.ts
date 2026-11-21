import { basename } from 'node:path'
import { createSpeechAddonSynthesize } from '../addons/speechAddon.js'
import { PiperSpeech, speechConfigFromEnv } from './piperSpeech.js'
import { SpeechVoices } from './voiceCatalog.js'

/** The one speech generator of this host - the `/speech` routes and the speech runner share it. */
const config = speechConfigFromEnv()
// The text becomes a WAV through the speech add-on (#964, addons/speechAddon.ts) in its sandbox; the cache, queue, trimming and errors around it are
// StageBoard's. The add-on is told the voice by its key ('' = the default voice), never a path.
export const serverSpeech = new PiperSpeech(config, createSpeechAddonSynthesize((model) => (model === config.voice ? '' : basename(model).replace(/\.onnx$/, ''))))
/** The voices it can speak with - listed, licensed and downloaded on request. */
export const serverVoices = new SpeechVoices(config.voicesDir)
