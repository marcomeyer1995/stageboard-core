import { useBandSettingsStore } from '../store/useBandSettingsStore'
import { useHostUrlStore } from '../store/useHostUrlStore'
import { backupHostOf } from './hostOverview'
import { getAutomaticHostUrl } from './hostUrl'

/** The name of the backup host while this device is on it, else null (#941) - the only thing the status bar
 * says about the hosts. Cheap: it reads two stores, it asks nobody. */
export function useBackupHostName(): string | null {
  const hosts = useBandSettingsStore((state) => state.settings.hosts)
  const override = useHostUrlStore((state) => state.url)
  return backupHostOf(hosts, override ?? getAutomaticHostUrl())
}
