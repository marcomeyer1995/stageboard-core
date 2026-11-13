import { usePracticeOutputStore } from '../lib/outputPlan'
import { useOutputPlanStore } from '../lib/audioMix'
import { useAppModeStore } from '../store/useAppModeStore'
import { useStageMapStore } from '../store/useStageMapStore'
import { choiceRow } from './ui'
import { useTranslation } from 'react-i18next'

/**
 * What this device practises by (docs/31 §0d, #742): everything on both ears, or a setup of the
 * band - then click, announcements and track sit where this device's matrix puts them there. In
 * the Gig the active setup decides; this choice is per device and only for practising.
 */
export function PracticeOutputSettings() {
  const { t } = useTranslation('system')
  const setups = useStageMapStore((state) => state.setups)
  const setupId = usePracticeOutputStore((state) => state.setupId)
  const setSetupId = usePracticeOutputStore((state) => state.setSetupId)
  const fellBack = useOutputPlanStore((state) => state.fellBack)
  const practising = useAppModeStore((state) => state.mode === 'practice')
  const options: { id: string | null; title: string; detail: string }[] = [
    { id: null, title: t('practiceOutput.both'), detail: t('practiceOutput.bothDetail') },
    ...setups.map((s) => ({ id: s.id, title: t('practiceOutput.setup', { name: s.name }), detail: t('practiceOutput.setupDetail') })),
  ]
  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('practiceOutput.label')}>
      {options.map((option) => (
        <button key={option.id ?? ''} type="button" role="radio" aria-checked={setupId === option.id} onClick={() => setSetupId(option.id)} className={choiceRow(setupId === option.id)}>
          <span className="flex flex-col text-left">
            <span className="text-base font-semibold">{option.title}</span>
            <span className="text-sm opacity-80">{option.detail}</span>
          </span>
        </button>
      ))}
      {practising && fellBack && (
        <p role="status" className="text-base text-ink-muted">
          {t('practiceOutput.fellBack')}
        </p>
      )}
    </div>
  )
}
