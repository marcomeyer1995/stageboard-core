import { HostCapabilitiesSchema, type HostCapabilities } from 'shared-types'
import { getStageServerUrl } from './stageServer'

/** What the Stage-Server can run (docs/25 §6) - null without a server, or from one that doesn't
 * say yet (built before 2026-11-07). */
export async function fetchHostCapabilities(): Promise<HostCapabilities | null> {
  const base = getStageServerUrl()
  if (!base) return null
  try {
    const response = await fetch(`${base}/server/capabilities`)
    if (!response.ok) return null
    const parsed = HostCapabilitiesSchema.safeParse(await response.json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
