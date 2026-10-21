import { CAPABILITIES } from 'shared-types'
import { pluginProviding } from '../lib/capabilities'
import { useAnnouncementsSwitchStore } from '../lib/useAnnouncementDriver'
import { usePluginsStore } from '../store/usePluginsStore'
import { Switch } from './ui'

/** Per device (#63): spoken section announcements on or off - only shown once the plugin is installed. */
export function AnnouncementSettings() {
  const on = useAnnouncementsSwitchStore((state) => state.on)
  const set = useAnnouncementsSwitchStore((state) => state.set)
  const installed = usePluginsStore((state) => state.installed)
  if (!pluginProviding(installed, CAPABILITIES.sectionAnnouncements)) return null
  return (
    <Switch
      label="Ansagen der Songteile"
      info="„Chorus“, „Bridge“ … einen Takt vor dem Teil, über denselben Ausgang wie der Klick - nur auf dem Gerät, das den Klick spielt."
      checked={on}
      onChange={set}
    />
  )
}
