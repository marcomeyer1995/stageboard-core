import { parseContributes, type Contributes, type SlotId } from 'shared-types'
// An add-on is one directory: manifest, work script, view script. The two scripts run in different places (the work script where the helpers are, the
// view script in the viewer's own Worker), so each side reads its own file from the same directory - until installing from a repository brings them (#17).
import youtubeManifest from '../../../../../addons/youtube/manifest.json'
import youtubeView from '../../../../../addons/youtube/view.js?raw'
import youtubeWork from '../../../../../addons/youtube/work.js?raw'
import stemManifest from '../../../../../addons/stem-separation/manifest.json'
import stemView from '../../../../../addons/stem-separation/view.js?raw'
import stemWork from '../../../../../addons/stem-separation/work.js?raw'
import oscManifest from '../../../../../addons/osc/manifest.json'
import oscView from '../../../../../addons/osc/view.js?raw'
import oscWork from '../../../../../addons/osc/work.js?raw'
import kemperManifest from '../../../../../addons/kemper/manifest.json'
import kemperWork from '../../../../../addons/kemper/work.js?raw'
import mg30Manifest from '../../../../../addons/nux-mg30/manifest.json'
import mg30Work from '../../../../../addons/nux-mg30/work.js?raw'
import rc500Manifest from '../../../../../addons/boss-rc500/manifest.json'
import rc500Work from '../../../../../addons/boss-rc500/work.js?raw'

/** An add-on that ships with the app: what it declared, and the script that fills its UI slots. */
export interface BuiltinAddon {
  id: string
  name: string
  contributes: Contributes
  /** The view script's source (docs/36 §2); empty for an add-on with no UI (a MIDI device's). */
  viewScript: string
  /** The work script's source: what this device runs when it answers the add-on's methods itself (no host can). */
  workScript: string
  /** Origins its images may come from: the `http:` permissions of its manifest. */
  imageOrigins: string[]
  permissions: string[]
}

function fromManifest(manifest: { id: string; name: string; permissions?: string[]; contributes?: unknown }, viewScript: string, workScript: string): BuiltinAddon {
  const permissions = manifest.permissions ?? []
  return {
    id: manifest.id,
    name: manifest.name,
    contributes: parseContributes(manifest.contributes).contributes,
    viewScript,
    workScript,
    imageOrigins: permissions.filter((p) => p.startsWith('http:')).map((p) => p.slice('http:'.length)),
    permissions,
  }
}

export const BUILTIN_ADDONS: readonly BuiltinAddon[] = [fromManifest(youtubeManifest, youtubeView, youtubeWork), fromManifest(oscManifest, oscView, oscWork), fromManifest(stemManifest, stemView, stemWork), fromManifest(kemperManifest, '', kemperWork), fromManifest(mg30Manifest, '', mg30Work), fromManifest(rc500Manifest, '', rc500Work)]

/** The installed add-ons that fill `slot`, with the entry each declared for it - in the order the band installed them. */
export function addonsForSlot(slot: SlotId, installedIds: readonly string[]): { addon: BuiltinAddon; entry: { id: string; title: string; icon?: string } }[] {
  return BUILTIN_ADDONS.filter((addon) => installedIds.includes(addon.id)).flatMap((addon) => addon.contributes.ui.filter((ui) => ui.slot === slot).map((ui) => ({ addon, entry: { id: ui.id, title: ui.title, ...(ui.icon ? { icon: ui.icon } : {}) } })))
}
