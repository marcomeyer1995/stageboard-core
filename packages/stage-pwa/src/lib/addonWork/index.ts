import { androidHelperCerts } from 'shared-types'
import i18n from '../../i18n'
import { findHelper } from '../nativeHelper'
import { usePluginsStore } from '../../store/usePluginsStore'
import { androidYtDlp, type AppHelper } from './appHelpers'
import { createLocalAddonMethods } from './localMethods'

/**
 * The helpers this device has for an add-on (docs/36 §5, #964). On Android the add-on's helper app, if the band installed it and it is signed with a
 * certificate the add-on's manifest trusts; elsewhere none - a browser has no programs. The name the add-on asks for is the same on every device.
 */
async function helpersFor(addonId: string): Promise<Record<string, AppHelper> | null> {
  if (addonId !== 'youtube-download') return null
  const manifest = usePluginsStore.getState().installed.find((plugin) => plugin.id === addonId && plugin.enabled)
  if (!manifest) return null
  const helper = await findHelper(addonId)
  return helper ? { 'yt-dlp': androidYtDlp(helper, androidHelperCerts(manifest)) } : null
}

/** The add-on methods this device answers itself - used when no host of the band can. */
export const localAddonMethods = createLocalAddonMethods({ helpersFor, language: () => i18n.language })
