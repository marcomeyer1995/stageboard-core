import { useEffect, useState } from 'react'
import { FOOTSWITCH_ACTIONS, isBindableKey, keyLabel, type FootswitchAction } from '../lib/keybindings'
import { footswitchCapture } from '../lib/useFootswitch'
import { useKeybindingsStore } from '../store/useKeybindingsStore'
import { Icon } from './Icon'

/**
 * Foot switch mapping (#27): per action the keys that trigger it, "Taste zuweisen" waits for the
 * next key - the pedal press - and assigns it. Works with any Bluetooth pedal that pairs as a
 * keyboard, and with a real keyboard.
 */
export function KeybindingSettings() {
  const bindings = useKeybindingsStore((state) => state.bindings)
  const assign = useKeybindingsStore((state) => state.assign)
  const remove = useKeybindingsStore((state) => state.remove)
  const reset = useKeybindingsStore((state) => state.reset)
  const [listening, setListening] = useState<FootswitchAction | null>(null)

  useEffect(() => {
    if (!listening) return
    footswitchCapture.active = true
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setListening(null)
        return
      }
      if (!isBindableKey(event.key)) return
      assign(listening, event.key)
      setListening(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      footswitchCapture.active = false
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [listening, assign])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">
        Bluetooth-Pedal (z. B. AirTurn, PageFlip) wie eine Tastatur koppeln, dann hier die Pedaltasten zuweisen. Wirkt auf den
        Dashboards - im Gig-Modus nur am Master-Gerät, wie die Knöpfe auf dem Bildschirm.
      </p>
      <ul className="flex flex-col gap-2">
        {FOOTSWITCH_ACTIONS.map(({ id, label }) => (
          <li key={id} className="flex flex-wrap items-center gap-2 rounded-sb-sm bg-control px-3 py-2">
            <span className="min-w-0 flex-1 text-base text-ink">{label}</span>
            {(bindings[id] ?? []).map((key) => (
              <span key={key} className="flex items-center gap-1 rounded-sb-sm bg-control-strong pl-3 text-sm font-semibold text-ink">
                {keyLabel(key)}
                <button
                  type="button"
                  onClick={() => remove(id, key)}
                  aria-label={`${keyLabel(key)} von „${label}“ entfernen`}
                  className="flex h-12 w-12 items-center justify-center rounded-sb-sm text-ink-muted hover:bg-control-hover hover:text-ink"
                >
                  <Icon name="close" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => setListening(listening === id ? null : id)}
              className={`min-h-12 rounded-sb-sm px-4 text-sm font-semibold ${
                listening === id ? 'bg-accent text-accent-ink' : 'bg-control-strong text-ink hover:bg-control-strong-hover'
              }`}
            >
              {listening === id ? 'Jetzt Pedal drücken … (Esc: abbrechen)' : 'Taste zuweisen'}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={reset} className="min-h-12 self-start rounded-sb-sm bg-control px-4 text-sm text-ink-soft hover:bg-control-hover">
        Auf Standard zurücksetzen (Bild ↓ = Weiter, Bild ↑ = Zurück)
      </button>
    </div>
  )
}
