import type { CapabilityId } from 'shared-types'
import type { Translator } from './clientTranslator'

/**
 * What a dynamically-loaded client plugin's default export must look like (#101) - the
 * browser-side sibling of `IPlugin`/`IShowControlPlugin` (shared-types/plugin.ts). A plugin
 * bundle is a plain ES module exporting one of these as `export default`; `loadClientPlugin.ts`
 * is the only thing that ever imports one.
 *
 * Only `registerTranslator` has a real consumer today (a dynamically-loaded plugin's Translator
 * would slot into the exact same `getTranslator`/`HardwareRoutingEngine` machinery #98 already
 * built for the static mock registry - wiring that up is left to a follow-up, see #101's PR).
 * The other three hooks are declared because the issue calls for the shape to exist, but stay
 * loosely typed (`unknown`) rather than fully speculated out: `registerWidgets` needs a real
 * dashboard-widget consumer, `registerEditorPanel` a real Song Editor per-plugin panel (today's
 * `CueListEditor` is generic, #99), and `registerHalProbe` real hardware detection (#106) -
 * none of which exist yet to design a precise interface against.
 */
export interface ClientPluginModule {
  id: string
  registerTranslator?: (capability: CapabilityId) => Translator
  registerWidgets?: () => unknown
  registerEditorPanel?: (capability: CapabilityId) => unknown
  registerHalProbe?: () => unknown
}
