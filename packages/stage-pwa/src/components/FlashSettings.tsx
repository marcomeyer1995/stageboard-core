import { useFlashPrefsStore, type FlashMode } from '../store/useFlashPrefsStore'

const OPTIONS: { mode: FlashMode; label: string; hint: string }[] = [
  { mode: 'banner', label: 'Banner', hint: 'Streifen oben, durchscheinend - der Rest bleibt bedienbar, Tippen auf den Streifen schließt ihn.' },
  { mode: 'fullscreen', label: 'Vollbild', hint: 'Über den ganzen Bildschirm, bis Tippen oder 8 Sekunden.' },
  { mode: 'off', label: 'Aus', hint: 'Keine Blitzmeldungen auf diesem Gerät.' },
]

/** Per device: how Stage-Messenger messages and song alerts show (#26). */
export function FlashSettings() {
  const mode = useFlashPrefsStore((state) => state.mode)
  const setMode = useFlashPrefsStore((state) => state.setMode)
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Blitzmeldungen anzeigen">
        {OPTIONS.map((option) => (
          <button
            key={option.mode}
            type="button"
            aria-pressed={mode === option.mode}
            onClick={() => setMode(option.mode)}
            className={`h-12 rounded-sb text-base font-semibold ${mode === option.mode ? 'bg-accent text-accent-ink' : 'bg-control text-ink-soft hover:bg-control-hover'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-ink-faint">{OPTIONS.find((option) => option.mode === mode)?.hint}</p>
    </div>
  )
}
