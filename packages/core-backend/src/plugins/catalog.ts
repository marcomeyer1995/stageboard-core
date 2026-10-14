import type { IShowControlPlugin } from 'shared-types'
import { createMockBackupPlugin } from './mockBackupPlugin.js'
import { createMockClickPlugin } from './mockClickPlugin.js'
import { createMockLightingPlugin } from './mockLightingPlugin.js'
import { createMockMixerPlugin } from './mockMixerPlugin.js'
import { createMockPlaybackPlugin } from './mockPlaybackPlugin.js'
import { createPiperSpeechPlugin, PIPER_SPEECH_PLUGIN_ID } from './piperSpeechPlugin.js'

/**
 * The server-side plugins this build knows how to construct, keyed by the id used in the
 * replicated PluginInstallation documents. Loading plugin code from a GitHub repository
 * (docs/01) will replace this map; until then, installing a plugin in the PWA means
 * "switch on the implementation that ships with the server".
 */
export const PLUGIN_CATALOG: Record<string, () => IShowControlPlugin> = {
  'mock-mixer': createMockMixerPlugin,
  'mock-lighting': createMockLightingPlugin,
  'mock-playback': createMockPlaybackPlugin,
  'mock-backup': createMockBackupPlugin,
  'mock-click': createMockClickPlugin,
  [PIPER_SPEECH_PLUGIN_ID]: createPiperSpeechPlugin,
}
