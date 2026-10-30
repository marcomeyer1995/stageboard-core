import { OUTPUT_ROUTINGS, useOutputRoutingStore, type OutputRouting } from '../lib/audioMix'
import { choiceRow } from './ui'
import { useTranslation } from 'react-i18next'

const KEY: Record<OutputRouting, 'mixed' | 'clickLeft' | 'clickRight'> = { mixed: 'mixed', 'click-left': 'clickLeft', 'click-right': 'clickRight' }

/**
 * Klick und Track trennen (#481 step 1, docs/21 §9.2): how this device's stereo output carries the
 * sources. Split, a Y-cable (or a stereo DI) gives two signals - the click side to the in-ears only,
 * the track side to FOH - so the audience never hears the click. Per device.
 */
export function OutputRoutingSettings() {
  const { t } = useTranslation('system')
  const routing = useOutputRoutingStore((state) => state.routing)
  const setRouting = useOutputRoutingStore((state) => state.setRouting)
  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('routing.label')}>
      {OUTPUT_ROUTINGS.map((option) => (
        <button key={option} type="button" role="radio" aria-checked={routing === option} onClick={() => setRouting(option)} className={choiceRow(routing === option)}>
          <span className="flex flex-col text-left">
            <span className="text-base font-semibold">{t(`routing.${KEY[option]}`)}</span>
            <span className="text-sm opacity-80">{t(`routing.${KEY[option]}Detail`)}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
