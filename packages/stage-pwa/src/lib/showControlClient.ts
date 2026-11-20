import type { ShowControlEvent, ShowControlResult } from 'shared-types'
import { serverText } from './serverMessage'
import { getHostUrl, NO_HOST_MESSAGE } from './hostUrl'

/** The low-latency cue channel CueGrid/ShowPlaybackWidget's comments have been waiting for. */
export async function triggerShowControl(
  pluginName: string,
  event: ShowControlEvent,
): Promise<ShowControlResult> {
  const base = getHostUrl()
  if (!base) return { status: 'error', message: NO_HOST_MESSAGE }

  try {
    const response = await fetch(`${base}/plugins/${pluginName}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
    const body = (await response.json()) as ShowControlResult
    if (!response.ok) return { status: 'error', message: serverText(body) ?? `HTTP ${response.status}` }
    // A plugin's own error (OSC, Demucs, ...) comes with status 200 - in this device's language too (#679).
    return body.status === 'error' ? { ...body, message: serverText(body) } : body
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}
