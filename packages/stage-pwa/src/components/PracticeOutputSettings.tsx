import { usePracticeOutputStore } from '../lib/outputPlan'
import { useOutputPlanStore } from '../lib/audioMix'
import { useActiveProfileStore } from '../store/useActiveProfileStore'
import { useAppModeStore } from '../store/useAppModeStore'
import { useStageMapStore } from '../store/useStageMapStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { Select } from './ui'
import { useTranslation } from 'react-i18next'

/**
 * What this device practises by (docs/31 §0d, #742): everything on both ears, or a setup of the
 * band - then click, announcements and track sit where this device's matrix puts them there. In
 * the Gig the active setup decides; this choice is per device and only for practising. Own setups
 * (#799) are offered to their owner only - the admin sees them in Stage, but practises by their own.
 * One dropdown, the chosen option's explanation once below it (Marco, 2026-11-14, #861: one big
 * row per setup, each with the same three lines, filled a phone screen).
 */
export function PracticeOutputSettings() {
  const { t } = useTranslation('system')
  const setups = useStageMapStore((state) => state.setups)
  const ownSetups = useStageMapStore((state) => state.ownSetups)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const profileId = useActiveProfileStore((state) => state.byWorkspace[workspaceId] ?? '')
  const mine = profileId === '' ? [] : ownSetups.filter((s) => s.owner === profileId)
  const setupId = usePracticeOutputStore((state) => state.setupId)
  const setSetupId = usePracticeOutputStore((state) => state.setSetupId)
  const fellBack = useOutputPlanStore((state) => state.fellBack)
  const practising = useAppModeStore((state) => state.mode === 'practice')
  const options: { id: string | null; title: string; detail: string }[] = [
    { id: null, title: t('practiceOutput.both'), detail: t('practiceOutput.bothDetail') },
    ...mine.map((s) => ({ id: s.id, title: t('practiceOutput.ownSetup', { name: s.name }), detail: t('practiceOutput.ownSetupDetail') })),
    ...setups.map((s) => ({ id: s.id, title: t('practiceOutput.setup', { name: s.name }), detail: t('practiceOutput.setupDetail') })),
  ]
  // Ids of the dropdown: '' stands for "both ears" (null).
  const chosen = options.find((option) => option.id === setupId) ?? options[0]!
  return (
    <div className="flex flex-col gap-2">
      <Select
        aria-label={t('practiceOutput.label')}
        value={chosen.id ?? ''}
        onChange={(e) => setSetupId(e.target.value === '' ? null : e.target.value)}
        options={options.map((option) => ({ value: option.id ?? '', label: option.title }))}
        className="w-full"
      />
      <p className="text-sm text-ink-muted">{chosen.detail}</p>
      {practising && fellBack && (
        <p role="status" className="text-base text-ink-muted">
          {t('practiceOutput.fellBack')}
        </p>
      )}
    </div>
  )
}
