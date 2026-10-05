import { FLASH_DURATION_MS, type FlashMessage } from 'shared-types'
import { getStageServerUrl } from './stageServer'

/** Quick messages for the Stage-Messenger widget (#26). */
export const FLASH_PRESETS = ['Noch 5 Minuten', 'Letzter Song', 'VAMP', 'Gitarre stimmen', 'Langsamer', 'Schneller', 'Schluss!']

/** Sends a flash message to every tablet of the band (via the Stage-Server). */
export async function sendFlash(workspaceId: string, text: string, from: string | undefined): Promise<boolean> {
  const base = getStageServerUrl()
  if (!base || !workspaceId) return false
  try {
    const response = await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/flash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, from }),
    })
    return response.ok
  } catch {
    return false
  }
}

/** Local alerts (a song's `{alert: ...}` reaching its time) use the same overlay as messages
 * from the server - delivered through this window event. */
export const LOCAL_FLASH_EVENT = 'stageboard:flash'

export function showLocalFlash(text: string): void {
  window.dispatchEvent(new CustomEvent<FlashMessage>(LOCAL_FLASH_EVENT, { detail: { id: `local-${Date.now()}-${text}`, text, at: Date.now() } }))
}

/** Whether a message that arrives now is still worth showing. */
export function isFresh(flash: FlashMessage, serverNow: number): boolean {
  return serverNow - flash.at < FLASH_DURATION_MS
}
