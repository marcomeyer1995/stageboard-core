import { CAPABILITIES, PluginInstallationSchema, type IShowControlPlugin, type PluginContext, type ShowControlEvent, type ShowControlResult } from 'shared-types'
import { allDocs, type CouchConfig } from '../couch.js'
import { workspaceDbName } from '../workspaceProvisioning.js'

/**
 * Ultimate Guitar import and YouTube download as Add-ons (#546, Marco 2026-10-16): both touch
 * third-party sites in a legally risky way (docs/16), so a band only gets them by installing them
 * - not installed, the server refuses the requests and the app hides the options. A sale build
 * (STAGEBOARD_SALE_BUILD=1) drops both from the catalogs; before a real sale the code itself has
 * to go (issue #546 step 5).
 */
export const ULTIMATE_GUITAR_PLUGIN_ID = 'ultimate-guitar-import'
export const YOUTUBE_DOWNLOAD_PLUGIN_ID = 'youtube-download'

/** The lookup provider id the UG add-on unlocks (lookupCatalog.ts). */
export const ULTIMATE_GUITAR_PROVIDER = 'ultimate-guitar-scraper'

export const SALE_BUILD = process.env.STAGEBOARD_SALE_BUILD === '1'

function addonPlugin(id: string, capability: string): () => IShowControlPlugin {
  return () => {
    let context: PluginContext | undefined
    return {
      name: id,
      version: '0.0.1',
      capabilities: [capability],
      init(ctx: PluginContext) {
        context = ctx
        ctx.log.info(`${id} ready`)
      },
      async trigger(event: ShowControlEvent): Promise<ShowControlResult> {
        if (event.type !== 'test') return { status: 'error', message: `${id}: unbekannter Event-Typ "${event.type}".` }
        context?.log.info(`${id} test`)
        return { status: 'ok' }
      },
    }
  }
}

export const createUltimateGuitarImportPlugin = addonPlugin(ULTIMATE_GUITAR_PLUGIN_ID, CAPABILITIES.chordImport)
export const createYoutubeDownloadPlugin = addonPlugin(YOUTUBE_DOWNLOAD_PLUGIN_ID, CAPABILITIES.videoDownload)

/** Whether the band has the add-on installed and switched on - read from its replicated
 * PluginInstallation documents, like the stem-separation check. */
export async function bandHasAddon(couch: CouchConfig, workspaceId: string, pluginId: string): Promise<boolean> {
  const docs = await allDocs<unknown>(couch, workspaceDbName(workspaceId), { startkey: 'plugins:', endkey: 'plugins:\ufff0' })
  return docs.some((doc) => {
    const parsed = PluginInstallationSchema.safeParse(doc)
    return parsed.success && parsed.data.id === pluginId && parsed.data.enabled
  })
}
