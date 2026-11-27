import { PluginInstallationSchema } from 'shared-types'

/** Whether the band has the add-on installed and switched on - from its replicated PluginInstallation documents (`plugins:`). A
 * document that does not parse counts as not installed: a half-replicated document must not let a job through. Once for every host. */
export function bandHasAddonIn(docs: readonly unknown[], addonId: string): boolean {
  return docs.some((doc) => {
    const parsed = PluginInstallationSchema.safeParse(doc)
    return parsed.success && parsed.data.id === addonId && parsed.data.enabled
  })
}
