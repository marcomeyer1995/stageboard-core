import type { IShowControlPlugin } from 'shared-types'
import { createMockLightingPlugin } from './mockLightingPlugin.js'
import { createMockMixerPlugin } from './mockMixerPlugin.js'
import { createMockPlaybackPlugin } from './mockPlaybackPlugin.js'

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
}
