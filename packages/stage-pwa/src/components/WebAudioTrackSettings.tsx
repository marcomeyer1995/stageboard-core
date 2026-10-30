import { useState } from 'react'
import { setWebAudioTrackEnabled, webAudioTrackEnabled } from '../lib/webAudioTrackEngine'
import { Switch } from './ui'
import { JumpCrossfadeSetting } from './JumpCrossfadeSetting'
import { useTranslation } from 'react-i18next'

/** Per device (#468, on by default since 2026-10-15): the Gig backing track on the click's Web Audio clock. */
export function WebAudioTrackSettings() {
  const { t } = useTranslation('system')
  const [on, setOn] = useState(webAudioTrackEnabled)
  return (
    <div className="flex flex-col gap-3">
    <Switch
      label={t('wa.label')}
      description={t('wa.next')}
      info={t('wa.info')}
      checked={on}
      onChange={(next) => {
        setWebAudioTrackEnabled(next)
        setOn(next)
      }}
    />
    {on && <JumpCrossfadeSetting />}
    </div>
  )
}
