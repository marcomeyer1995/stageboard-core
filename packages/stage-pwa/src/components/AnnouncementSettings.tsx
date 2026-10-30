import { CAPABILITIES } from 'shared-types'
import { pluginProviding } from '../lib/capabilities'
import { useAnnouncementsSwitchStore } from '../lib/useAnnouncementDriver'
import { usePluginsStore } from '../store/usePluginsStore'
import { Switch } from './ui'
import { useTranslation } from 'react-i18next'

/** Per device (#63): spoken section announcements on or off - only shown once the plugin is installed. */
export function AnnouncementSettings() {
  const { t } = useTranslation('addons')
  const on = useAnnouncementsSwitchStore((state) => state.on)
  const set = useAnnouncementsSwitchStore((state) => state.set)
  const installed = usePluginsStore((state) => state.installed)
  if (!pluginProviding(installed, CAPABILITIES.sectionAnnouncements)) return null
  return (
    <Switch
      label={t('ann.switch')}
      info={t('ann.switchInfo')}
      checked={on}
      onChange={set}
    />
  )
}
