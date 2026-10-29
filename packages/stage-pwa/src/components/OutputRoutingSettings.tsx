import { OUTPUT_ROUTINGS, useOutputRoutingStore, type OutputRouting } from '../lib/audioMix'
import { choiceRow } from './ui'

const LABEL: Record<OutputRouting, { title: string; detail: string }> = {
  mixed: { title: 'Alles gemischt (Stereo)', detail: 'Track, Klick und Ansagen auf beiden Seiten - wie bisher.' },
  'click-left': { title: 'Klick links · Track rechts', detail: 'Links Klick und Ansagen, rechts der Track in Mono.' },
  'click-right': { title: 'Klick rechts · Track links', detail: 'Rechts Klick und Ansagen, links der Track in Mono.' },
}

/**
 * Klick und Track trennen (#481 step 1, docs/21 §9.2): how this device's stereo output carries the
 * sources. Split, a Y-cable (or a stereo DI) gives two signals - the click side to the in-ears only,
 * the track side to FOH - so the audience never hears the click. Per device.
 */
export function OutputRoutingSettings() {
  const routing = useOutputRoutingStore((state) => state.routing)
  const setRouting = useOutputRoutingStore((state) => state.setRouting)
  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label="Ausgang">
      {OUTPUT_ROUTINGS.map((option) => (
        <button key={option} type="button" role="radio" aria-checked={routing === option} onClick={() => setRouting(option)} className={choiceRow(routing === option)}>
          <span className="flex flex-col text-left">
            <span className="text-base font-semibold">{LABEL[option].title}</span>
            <span className="text-sm opacity-80">{LABEL[option].detail}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
