import { useEffect, useRef, useState } from 'react'
import { FLASH_DURATION_MS, type FlashMessage } from 'shared-types'
import { getServerTime } from '../lib/clockSync'
import { isFresh, LOCAL_FLASH_EVENT } from '../lib/flash'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useFlashPrefsStore } from '../store/useFlashPrefsStore'
import { usePresenceStore } from '../store/usePresenceStore'

/** Whether a message is for this device's person: no recipients = everyone. */
export function isForMe(flash: FlashMessage, profileId: string | undefined): boolean {
  return !flash.to?.length || (profileId !== undefined && flash.to.includes(profileId))
}

/**
 * Stage-Messenger flash (#26): a short message from the Stage-Messenger widget on any device
 * (pushed on the presence stream; only shown by the people it is addressed to) or a song's
 * `{alert: ...}` reaching its time on this device. Per device (Einstellungen → Blitzmeldungen):
 * a see-through banner under the status bar - only as big as the message, the rest of the screen
 * stays playable, a tap on it closes it (Marco, #400 review) -, the whole screen, or off. Gone after
 * the device's display time (Einstellungen, 3-20 s, default 8).
 */
export function FlashOverlay() {
  const mode = useFlashPrefsStore((state) => state.mode)
  const seconds = useFlashPrefsStore((state) => state.seconds)
  const enabled = mode !== 'off'
  const profileId = useActiveProfile()?.id
  const remote = usePresenceStore((state) => state.presence.flash)
  const [shown, setShown] = useState<FlashMessage | null>(null)
  const seen = useRef(new Set<string>())

  // From the server: each message once, and only while it is fresh (not one that was sent
  // minutes ago and arrives with the first snapshot after opening the app).
  useEffect(() => {
    if (!remote || seen.current.has(remote.id)) return
    seen.current.add(remote.id)
    if (enabled && isForMe(remote, profileId) && isFresh(remote, getServerTime())) setShown(remote)
  }, [remote, enabled, profileId])

  useEffect(() => {
    const onLocal = (event: Event) => {
      if (useFlashPrefsStore.getState().mode !== 'off') setShown((event as CustomEvent<FlashMessage>).detail)
    }
    window.addEventListener(LOCAL_FLASH_EVENT, onLocal)
    return () => window.removeEventListener(LOCAL_FLASH_EVENT, onLocal)
  }, [])

  useEffect(() => {
    if (!shown) return
    const timer = setTimeout(() => setShown(null), (seconds || FLASH_DURATION_MS / 1000) * 1000)
    return () => clearTimeout(timer)
  }, [shown, seconds])

  if (!shown) return null
  if (mode === 'banner') {
    // Under the status bar, wherever it ends on this screen (none on a dashboard without it).
    const top = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0
    return (
      <div
        role="alert"
        style={{ top }}
        onClick={() => setShown(null)}
        className="fixed inset-x-2 cursor-pointer z-[58] flex max-h-[30dvh] flex-col items-center justify-center gap-1 rounded-sb bg-yellow-300/85 px-4 py-3 text-center text-black shadow-sb"
      >
        <p className="max-w-full break-words text-[clamp(2rem,6vw,4.5rem)] font-black uppercase leading-none tracking-tight">{shown.text}</p>
        {shown.from && <p className="text-lg font-bold">— {shown.from}</p>}
      </div>
    )
  }
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
