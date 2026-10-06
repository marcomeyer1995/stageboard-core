import { FLASH_DURATION_MS, type FlashMessage } from 'shared-types'
import { getStageServerUrl } from './stageServer'

/** Quick messages for the Stage-Messenger widget (#26). */
export const FLASH_PRESETS = ['Noch 5 Minuten', 'Letzter Song', 'VAMP', 'Gitarre stimmen', 'Langsamer', 'Schneller', 'Schluss!']

export type SendFlashResult = 'sent' | 'not-signed-in' | 'unreachable'

/** Sends a flash message to every tablet of the band (via the Stage-Server), signed with this
 * device's own login for the band - the server only takes messages from the band's devices. */
export async function sendFlash(
  workspaceId: string,
  text: string,
  from: string | undefined,
  login: { username?: string; password?: string },
  to: string[] = [],
): Promise<SendFlashResult> {
  const base = getStageServerUrl()
  if (!base || !workspaceId) return 'unreachable'
  if (!login.username || !login.password) return 'not-signed-in'
  try {
    const response = await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/flash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${btoa(`${login.username}:${login.password}`)}` },
      body: JSON.stringify({ text, from, ...(to.length ? { to } : {}) }),
    })
    if (response.status === 401) return 'not-signed-in'
    return response.ok ? 'sent' : 'unreachable'
  } catch {
    return 'unreachable'
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
