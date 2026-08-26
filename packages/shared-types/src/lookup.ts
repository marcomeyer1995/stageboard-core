import { z } from 'zod'
import type { IPlugin } from './plugin.js'

/** One candidate a search turned up - enough to show a picker before committing to fetchDetail. */
export const LookupResultSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  sourceUrl: z.string().optional(),
})
export type LookupResult = z.infer<typeof LookupResultSchema>

/**
 * A read-only external data source (tab scraper, metadata lookup) - deliberately not
 * IShowControlPlugin: that interface is a one-way fire-and-forget command channel built for
 * hardware cues, with no room for a query returning several candidate results to choose
 * among. Routed by a separate LookupRegistry/LOOKUP_CATALOG (core-backend), the same
 * mechanical pattern as the show-control plugin family, just for query/response instead of
 * trigger/response.
 */
export interface ILookupPlugin extends IPlugin {
  search(query: string): Promise<LookupResult[]>
  fetchDetail(resultId: string): Promise<Record<string, unknown>>
}
