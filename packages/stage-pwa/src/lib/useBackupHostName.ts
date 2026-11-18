import { useBandSettingsStore } from '../store/useBandSettingsStore'
import { useStageServerStore } from '../store/useStageServerStore'
import { backupHostOf } from './hostOverview'
import { getAutomaticStageServerUrl } from './stageServer'

/** The name of the backup host while this device is on it, else null (#941) - the only thing the status bar
 * says about the hosts. Cheap: it reads two stores, it asks nobody. */
export function useBackupHostName(): string | null {
  const hosts = useBandSettingsStore((state) => state.settings.hosts)
  const override = useStageServerStore((state) => state.url)
  return backupHostOf(hosts, override ?? getAutomaticStageServerUrl())
}
