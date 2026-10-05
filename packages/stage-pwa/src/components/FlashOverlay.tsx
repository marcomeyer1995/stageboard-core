import { useEffect, useRef, useState } from 'react'
import { FLASH_DURATION_MS, type FlashMessage } from 'shared-types'
import { getServerTime } from '../lib/clockSync'
import { isFresh, LOCAL_FLASH_EVENT } from '../lib/flash'
import { useFlashPrefsStore } from '../store/useFlashPrefsStore'
import { usePresenceStore } from '../store/usePresenceStore'

/**
 * Stage-Messenger flash (#26): a huge, high-contrast message over the whole screen for a few
 * seconds - from the Stage-Messenger widget on any device (pushed on the presence stream) or a
 * song's `{alert: ...}` reaching its time on this device. Gone after FLASH_DURATION_MS or a tap,
 * so the dashboard is never covered for long. Off per device in Einstellungen.
 */
export function FlashOverlay() {
  const enabled = useFlashPrefsStore((state) => state.enabled)
  const remote = usePresenceStore((state) => state.presence.flash)
  const [shown, setShown] = useState<FlashMessage | null>(null)
  const seen = useRef(new Set<string>())

  // From the server: each message once, and only while it is fresh (not one that was sent
  // minutes ago and arrives with the first snapshot after opening the app).
  useEffect(() => {
    if (!remote || seen.current.has(remote.id)) return
    seen.current.add(remote.id)
    if (enabled && isFresh(remote, getServerTime())) setShown(remote)
  }, [remote, enabled])

  useEffect(() => {
    const onLocal = (event: Event) => {
      if (useFlashPrefsStore.getState().enabled) setShown((event as CustomEvent<FlashMessage>).detail)
    }
    window.addEventListener(LOCAL_FLASH_EVENT, onLocal)
    return () => window.removeEventListener(LOCAL_FLASH_EVENT, onLocal)
  }, [])

  useEffect(() => {
    if (!shown) return
    const timer = setTimeout(() => setShown(null), FLASH_DURATION_MS)
    return () => clearTimeout(timer)
  }, [shown])

  if (!shown) return null
  return (
    <div
      role="alert"
      onClick={() => setShown(null)}
      className="fixed inset-0 z-[58] flex cursor-pointer flex-col items-center justify-center gap-4 bg-yellow-300 p-6 text-center text-black"
    >
      <p className="max-w-full break-words text-[clamp(3rem,11vw,9rem)] font-black uppercase leading-none tracking-tight">{shown.text}</p>
      {shown.from && <p className="text-2xl font-bold">— {shown.from}</p>}
      <p className="text-lg font-semibold opacity-70">Tippen zum Schließen</p>
    </div>
  )
}
