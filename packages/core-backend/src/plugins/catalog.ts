import type { IShowControlPlugin } from 'shared-types'
import { loadAddonInfos } from '../addons/addonMethods.js'
import { createOscAddonPlugin } from '../addons/oscAddon.js'
import { createAddonPlugin } from './addonPlugin.js'
import { createMockBackupPlugin } from './mockBackupPlugin.js'
import { createMockClickPlugin } from './mockClickPlugin.js'
import { createMockLightingPlugin } from './mockLightingPlugin.js'
import { createMockMixerPlugin } from './mockMixerPlugin.js'
import { createMockPlaybackPlugin } from './mockPlaybackPlugin.js'
import { createMidiDeviceAddonPlugin } from './midiDevicePlugin.js'
import { OSC_PLUGIN_ID } from './oscPlugin.js'

/** A sale build leaves out the add-ons their manifest marks as legally risky (#546). */
export const SALE_BUILD = process.env.STAGEBOARD_SALE_BUILD === '1'

/**
 * The plug-ins this build knows how to construct, keyed by the id used in the replicated PluginInstallation documents. The test plug-ins are
 * written here; every add-on that provides a capability is made from its **manifest** (`plugins/addonPlugin.ts`), so the core keeps no list of add-ons.
 * Loading add-ons from a repository (#17) will add to this by the same route.
 */
export const PLUGIN_CATALOG: Record<string, () => IShowControlPlugin> = {
  'mock-mixer': createMockMixerPlugin,
  'mock-lighting': createMockLightingPlugin,
  'mock-playback': createMockPlaybackPlugin,
  'mock-backup': createMockBackupPlugin,
  'mock-click': createMockClickPlugin,
  // OSC sends show-control events through its add-on's method, so it brings a plug-in of its own.
  [OSC_PLUGIN_ID]: createOscAddonPlugin,
  ...Object.fromEntries(
    loadAddonInfos()
      .filter((info) => info.provides.length > 0 && !(SALE_BUILD && info.legalRisk))
      // A MIDI device's add-on gets the cues for a device of it plugged into this host; any other add-on is the registry's handle for its methods.
      .map((info) => [info.pluginId, () => (info.midiDevice ? createMidiDeviceAddonPlugin(info) : createAddonPlugin(info))] as const),
  ),
}
