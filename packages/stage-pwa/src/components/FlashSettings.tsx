import { useFlashPrefsStore } from '../store/useFlashPrefsStore'

/** Per-device switch for Stage-Messenger flash messages and song alerts (#26). */
export function FlashSettings() {
  const enabled = useFlashPrefsStore((state) => state.enabled)
  const setEnabled = useFlashPrefsStore((state) => state.setEnabled)
  return (
    <label className="flex min-h-12 cursor-pointer items-center gap-3 text-base text-ink">
      <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-6 w-6" />
      Blitzmeldungen anzeigen
    </label>
  )
}
