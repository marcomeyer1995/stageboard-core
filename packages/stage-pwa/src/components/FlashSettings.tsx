import { FLASH_SECONDS, useFlashPrefsStore, type FlashMode } from '../store/useFlashPrefsStore'
import { Button, Segmented, Stepper } from './ui'
import { showLocalFlash } from '../lib/flash'

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
      <Segmented label="Blitzmeldungen anzeigen" value={mode} onChange={setMode} options={OPTIONS.map((option) => ({ value: option.mode, label: option.label }))} />
      <p className="text-sm text-ink-faint">{OPTIONS.find((option) => option.mode === mode)?.hint(seconds)}</p>
      {/* Shows a sample with the current look and duration - on this device only, nobody else
          gets it (Marco, 2026-10-07). */}
      {mode !== 'off' && (
        <Button icon="eye" onClick={() => showLocalFlash('Vorschau: Noch 5 Minuten')} className="self-start">
          Vorschau
        </Button>
      )}
      {mode !== 'off' && (
        // − / + instead of a slider (Marco, 2026-10-16), like the text size.
        <Stepper label="Anzeigedauer" value={seconds} unit="s" min={FLASH_SECONDS.min} max={FLASH_SECONDS.max} onChange={setSeconds} />
      )}
    </div>
  )
}
