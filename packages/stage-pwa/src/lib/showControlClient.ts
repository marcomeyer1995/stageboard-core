import type { ShowControlEvent, ShowControlResult } from 'shared-types'
import { getStageServerUrl } from './stageServer'

/** The low-latency cue channel CueGrid/ShowPlaybackWidget's comments have been waiting for. */
export async function triggerShowControl(
  pluginName: string,
  event: ShowControlEvent,
): Promise<ShowControlResult> {
  const base = getStageServerUrl()
  if (!base) return { status: 'error', message: 'VITE_STAGE_SERVER_URL is not configured' }

  try {
    const response = await fetch(`${base}/plugins/${pluginName}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
    const body = (await response.json()) as ShowControlResult
    if (!response.ok) return { status: 'error', message: body.message ?? `HTTP ${response.status}` }
    return body
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}
