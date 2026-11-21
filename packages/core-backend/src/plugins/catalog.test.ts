import { describe, expect, it } from 'vitest'
import { loadAddonInfos, pluginIdProviding, pluginIdWorking } from '../addons/addonMethods.js'
import { createAddonPlugin } from './addonPlugin.js'
import { PLUGIN_CATALOG } from './catalog.js'
import { LOOKUP_ADDONS, LOOKUP_CATALOG } from './lookupCatalog.js'

describe('what the core knows of the add-ons comes from their manifests (#964)', () => {
  const infos = loadAddonInfos()

  it('registers a plug-in for every add-on that provides a capability, under the id of the band\'s installation', () => {
    for (const id of ['youtube-download', 'ultimate-guitar-import', 'piper-speech', 'stem-separation']) expect(Object.keys(PLUGIN_CATALOG)).toContain(id)
    expect(infos.find((i) => i.id === 'ultimate-guitar-scraper')?.pluginId).toBe('ultimate-guitar-import')
  })

  it('answers look-ups for the add-ons whose manifest says so, and only Ultimate Guitar needs the band to have installed it', () => {
    expect(Object.keys(LOOKUP_CATALOG).sort()).toEqual(['metadata-lookup', 'ultimate-guitar-scraper'])
    expect(LOOKUP_ADDONS.filter((i) => i.lookup?.requiresInstall).map((i) => i.id)).toEqual(['ultimate-guitar-scraper'])
  })

  it('finds who provides a capability and who works a job type', () => {
    expect(pluginIdProviding('speech-synthesis')).toBe('piper-speech')
    expect(pluginIdProviding('nothing-like-it')).toBeNull()
    expect(pluginIdWorking('stem-separation')).toBe('stem-separation')
  })

  it('a plug-in made from a manifest tests ok when its helpers are there, and names the missing program when not', async () => {
    const base = { id: 'x', pluginId: 'x-plugin', name: 'X', provides: ['video-download'], legalRisk: false, lookup: null, asyncJobType: null }
    expect(await createAddonPlugin({ ...base, helpers: [] }).trigger({ type: 'test', payload: {}, logicalDeviceId: 'l' })).toEqual({ status: 'ok' })
    const before = process.env.YT_DLP_PATH
    process.env.YT_DLP_PATH = '/no/such/yt-dlp'
    try {
      const lacking = await createAddonPlugin({ ...base, helpers: ['yt-dlp'] }).trigger({ type: 'test', payload: {}, logicalDeviceId: 'l' })
      expect(lacking).toMatchObject({ status: 'error', messageCode: 'addon.toolMissing', messageParams: { tool: 'yt-dlp', addon: 'x-plugin' } })
    } finally {
      if (before === undefined) delete process.env.YT_DLP_PATH
      else process.env.YT_DLP_PATH = before
    }
    expect(await createAddonPlugin({ ...base, helpers: [] }).trigger({ type: 'other', payload: {}, logicalDeviceId: 'l' })).toMatchObject({ status: 'error', messageCode: 'plugin.unknownEvent' })
  })
})
