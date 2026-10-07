import { FLASH_SECONDS, useFlashPrefsStore, type FlashMode } from '../store/useFlashPrefsStore'

const OPTIONS: { mode: FlashMode; label: string; hint: (seconds: number) => string }[] = [
  { mode: 'banner', label: 'Banner', hint: (s) => `Streifen oben, durchscheinend, bis Tippen oder ${s} Sekunden - der Rest bleibt bedienbar.` },
  { mode: 'fullscreen', label: 'Vollbild', hint: (s) => `Über den ganzen Bildschirm, bis Tippen oder ${s} Sekunden.` },
  { mode: 'off', label: 'Aus', hint: () => 'Keine Blitzmeldungen auf diesem Gerät.' },
]

/** Per device: how Stage-Messenger messages and song alerts show (#26). */
export function FlashSettings() {
  const mode = useFlashPrefsStore((state) => state.mode)
  const setMode = useFlashPrefsStore((state) => state.setMode)
  const seconds = useFlashPrefsStore((state) => state.seconds)
  const setSeconds = useFlashPrefsStore((state) => state.setSeconds)
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Blitzmeldungen anzeigen">
        {OPTIONS.map((option) => (
          <button
            key={option.mode}
            type="button"
            aria-pressed={mode === option.mode}
            onClick={() => setMode(option.mode)}
            className={`h-12 rounded-control text-base font-semibold ${mode === option.mode ? 'bg-accent text-accent-ink' : 'bg-control text-ink-soft [@media(hover:hover)]:hover:bg-control-hover'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-ink-faint">{OPTIONS.find((option) => option.mode === mode)?.hint(seconds)}</p>
      {mode !== 'off' && (
        <label className="flex flex-col gap-1 text-base text-ink-soft">
          <span className="flex items-center justify-between">
            Anzeigedauer
            <span className="text-ink-faint">{seconds} s</span>
          </span>
          <input
            type="range"
            min={FLASH_SECONDS.min}
            max={FLASH_SECONDS.max}
            step={1}
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
            className="h-12 w-full accent-accent"
          />
        </label>
      )}
    </div>
  )
}
