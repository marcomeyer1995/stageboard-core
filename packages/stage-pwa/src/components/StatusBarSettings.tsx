import { STATUS_BAR_ITEM_LABEL } from '../lib/statusBarItems'
import { useStatusBarPrefsStore } from '../store/useStatusBarPrefsStore'
import { Button, IconButton, Switch } from './ui'

/**
 * The status bar's ranking on this device (Marco, 2026-10-07): what matters most stays longest.
 * Top = most important; when room runs out the bar gives items up from the bottom. A switch
 * hides an item for good.
 */
export function StatusBarSettings() {
  const order = useStatusBarPrefsStore((state) => state.order)
  const hidden = useStatusBarPrefsStore((state) => state.hidden)
  const move = useStatusBarPrefsStore((state) => state.move)
  const setShown = useStatusBarPrefsStore((state) => state.setShown)
  const reset = useStatusBarPrefsStore((state) => state.reset)
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-faint">
        Oben = wichtiger. Wird es eng, verschwindet von unten her zuerst etwas. Immer da: Menü, Status-Symbol, Songtitel und Spielzeit; Fehler zeigen
        immer ihr Wort.
      </p>
      <ol className="flex flex-col gap-2" aria-label="Statusleiste - Reihenfolge">
        {order.map((item, index) => (
          <li key={item} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Switch label={STATUS_BAR_ITEM_LABEL[item]} checked={!hidden.includes(item)} onChange={(on) => setShown(item, on)} />
            </div>
            <IconButton icon="up" label={`${STATUS_BAR_ITEM_LABEL[item]} wichtiger`} disabled={index === 0} onClick={() => move(item, -1)} />
            <IconButton icon="down" label={`${STATUS_BAR_ITEM_LABEL[item]} weniger wichtig`} disabled={index === order.length - 1} onClick={() => move(item, 1)} />
          </li>
        ))}
      </ol>
      <Button variant="quiet" onClick={reset} className="self-start">
        Standard wiederherstellen
      </Button>
    </div>
  )
}
