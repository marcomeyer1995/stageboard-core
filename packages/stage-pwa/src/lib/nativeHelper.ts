import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { isNativeApp } from './native'

/**
 * Native helpers of add-ons on Android (docs/32 §8, NativeHelperPlugin.java): separate app
 * packages a band installs itself - never code loaded into StageBoard. StageBoard only talks to a
 * helper signed with a certificate the add-on trusts (`certSha256`); the helper checks StageBoard
 * in turn.
 */

export interface HelperInfo {
  package: string
  certSha256: string | null
  apiVersion: number
  versionName?: string
  versionCode?: number
}

interface NativeHelperPluginApi {
  find(options: { addonId: string }): Promise<({ installed: false } | ({ installed: true } & HelperInfo))>
  run(options: { addonId: string; certSha256: string; requestId: string; op: string; args: string; output: boolean }): Promise<{ json: string; file?: string }>
  cancel(options: { requestId: string }): Promise<void>
  release(options: { requestId: string }): Promise<void>
  addListener(event: 'helperProgress', listener: (e: { requestId: string; value: number }) => void): Promise<PluginListenerHandle>
}

const NativeHelper = registerPlugin<NativeHelperPluginApi>('NativeHelper')

/** A helper's answer as an error: `code` is a message code the device translates (docs/03). */
export class HelperError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** The helper serving `addonId` on this device - null outside the Android app or when none is installed. */
export async function findHelper(addonId: string): Promise<HelperInfo | null> {
  if (!isNativeApp()) return null
  try {
    const found = await NativeHelper.find({ addonId })
    return found.installed ? found : null
  } catch {
    return null
  }
}

/** Whether a found helper is one this add-on trusts: signed with one of `trusted` (lowercase hex). */
export function trustedHelper(helper: HelperInfo | null, trusted: readonly string[]): helper is HelperInfo & { certSha256: string } {
  return helper !== null && helper.certSha256 !== null && trusted.includes(helper.certSha256.toLowerCase())
}

export interface HelperRun<T> {
  result: T
  /** What the helper wrote (output requested), already read and its file released. */
  file: Blob | null
}

/**
 * One request to a trusted helper. Rejects with HelperError. `signal` cancels it (the helper
 * stops, the call rejects with `helper.cancelled`).
 */
export async function runHelper<T>(
  addonId: string,
  helper: HelperInfo & { certSha256: string },
  op: string,
  args: unknown,
  options: { output?: boolean; onProgress?: (value: number) => void; signal?: AbortSignal } = {},
): Promise<HelperRun<T>> {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const listener = await NativeHelper.addListener('helperProgress', (e) => {
    if (e.requestId === requestId) options.onProgress?.(e.value)
  })
  const onAbort = () => void NativeHelper.cancel({ requestId }).catch(() => {})
  options.signal?.addEventListener('abort', onAbort)
  try {
    const answer = await NativeHelper.run({ addonId, certSha256: helper.certSha256, requestId, op, args: JSON.stringify(args), output: options.output === true }).catch((err: { code?: string; message?: string }) => {
      throw new HelperError(err.code ?? 'helper.failed', err.message ?? String(err))
    })
    let file: Blob | null = null
    if (answer.file) {
      // Read through the WebView's own file access, then the helper's file goes.
      const response = await fetch(Capacitor.convertFileSrc(answer.file))
      file = response.ok ? await response.blob() : null
      await NativeHelper.release({ requestId }).catch(() => {})
      if (!file) throw new HelperError('helper.failed', `could not read ${answer.file}`)
    }
    return { result: JSON.parse(answer.json) as T, file }
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
    await listener.remove()
  }
}
