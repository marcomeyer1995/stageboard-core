import type { HostCapabilities } from 'shared-types'
import { jobOfRequest } from 'sync-host'
import { getHostUrl } from './hostUrl'

export { chooseHostForJob, type HostCandidate, type JobHostChoice } from './jobChoice'
import { chooseHostForJob, type HostCandidate } from './jobChoice'
import { chooseExecutor, type Executor, type Load, type Self } from './executorChoice'

const TTL_MS = 30_000
const cache = new Map<string, { at: number; capabilities: HostCapabilities | null }>()

async function capabilitiesOf(url: string): Promise<HostCapabilities | null> {
  const known = cache.get(url)
  if (known && Date.now() - known.at < TTL_MS) return known.capabilities
  let capabilities: HostCapabilities | null = null
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/host/capabilities`, { signal: AbortSignal.timeout(3_000) })
    if (response.ok) capabilities = (await response.json()) as HostCapabilities
  } catch {
    // unreachable: no capabilities
  }
  cache.set(url, { at: Date.now(), capabilities })
  return capabilities
}

export function forgetHostCapabilities(): void {
  cache.clear()
}

/** The base URL for a request, or a refusal that says what is missing. Not a job request: the current host, as before. */
export async function resolveHostFor(method: string, path: string): Promise<{ base: string } | { base: null; message: string }> {
  const current = getHostUrl()
  const job = jobOfRequest(method, path)
  if (!current) return { base: null, message: 'no-host' }
  if (job === null) return { base: current }
  // Loaded when needed: the band's settings pull in the database, which a plain request to the current host does not need.
  const { useBandSettingsStore } = await import('../store/useBandSettingsStore')
  const listed = (useBandSettingsStore.getState().settings.hosts ?? []).map((h) => h.url).filter((url) => url.replace(/\/+$/, '') !== current.replace(/\/+$/, ''))
  const choice = chooseHostForJob(job, { url: current, capabilities: await capabilitiesOf(current) }, await Promise.all(listed.map(async (url) => ({ url, capabilities: await capabilitiesOf(url) }))))
  if (choice.url !== null) return { base: choice.url }
  return { base: null, message: [choice.needs ? `Missing: ${choice.needs}.` : '', choice.note ?? ''].filter(Boolean).join(' ') || `No host of this band can do "${job}".` }
}

/** The host this device is on and the other hosts the band lists, with what each says it can do. Not asked at all when no host is set. */
async function candidates(): Promise<{ current: HostCandidate | null; others: HostCandidate[] }> {
  const current = getHostUrl()
  if (!current) return { current: null, others: [] }
  // Loaded when needed: the band's settings pull in the database, which a plain request to the current host does not need.
  const { useBandSettingsStore } = await import('../store/useBandSettingsStore')
  const listed = (useBandSettingsStore.getState().settings.hosts ?? []).map((h) => h.url).filter((url) => url.replace(/\/+$/, '') !== current.replace(/\/+$/, ''))
  return {
    current: { url: current, capabilities: await capabilitiesOf(current) },
    others: await Promise.all(listed.map(async (url) => ({ url, capabilities: await capabilitiesOf(url) }))),
  }
}

/**
 * Who does an add-on's work (#964, "first myself, then hand on"): this device when it can - a heavy method only if no host is clearly stronger - else the
 * host it is on, else another host of the band (`chooseExecutor`). A light job that this device does itself asks no host anything.
 */
export async function resolveExecutorFor(addonId: string, load: Load, self: Self): Promise<Executor> {
  const job = `plugin:${addonId}`
  if (self.canRun && load === 'light') return { where: 'self' }
  const { current, others } = await candidates()
  return chooseExecutor({ job, load, self, current, others })
}
