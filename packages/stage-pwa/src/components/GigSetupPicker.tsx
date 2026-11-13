import { activeSetup } from 'shared-types'
import { useShowStateStore } from '../store/useShowStateStore'
import { useStageMapStore } from '../store/useStageMapStore'
import { PickRow } from './PickRow'
import { useTranslation } from 'react-i18next'

/**
 * The stage setup the Gig goes by, in the ☰ drawer (#745, docs/31 §6 step 5): the master picks it
 * like the setlist, everyone else reads it. It decides which device plays Klick, Track and Ansagen
 * and where plugin devices send - so it stays while a song plays.
 */
export function GigSetupPicker() {
  const setups = useStageMapStore((state) => state.setups)
  const applies = useStageMapStore((state) => (state.loaded ? (activeSetup(state)?.id ?? null) : null))
  const isMaster = useShowStateStore((state) => state.isMaster)
  const playing = useShowStateStore((state) => state.state.playbackStatus === 'playing')
  const setActiveSetup = useShowStateStore((state) => state.setActiveSetup)
  const { t } = useTranslation('menu')
  return <PickRow title={t('setup.title')} items={setups} activeId={applies} onPick={(id) => void setActiveSetup(id)} readOnly={!isMaster} locked={playing} lockedHint={t('setup.locked')} />
}
