import { useTranslation } from 'react-i18next'
import { assignHostRole, removeHostRole } from '../lib/bandHosts'
import { fetchBandHost } from '../lib/fetchBandHost'
import { getHostUrl } from '../lib/hostUrl'
import { useBandSettingsStore } from '../store/useBandSettingsStore'
import { useDialogStore } from '../store/useDialogStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { Badge, Button } from './ui'

/**
 * Primary and backup host on the stage map (host backup, #914, docs/25 §6e): shown at the box that
 * runs the Host. The admin names the host's address once; the app reads who it is and its
 * certificate fingerprint from the host itself, and saves the entry with this box in the band
 * settings, so every device has the same list. Not changeable while a song plays - a role changing
 * mid-song is what the epoch is there to prevent. A backup needs nothing else from the admin: the
 * primary sees the new entry in the list, notices the host serves no band yet and teaches it (#945).
 */
export function HostRole({ boxId, canEdit }: { boxId: string; canEdit: boolean }) {
  const { t } = useTranslation('hardware')
  const settings = useBandSettingsStore((state) => state.settings)
  const save = useBandSettingsStore((state) => state.save)
  const promptText = useDialogStore((state) => state.promptText)
  const alert = useDialogStore((state) => state.alert)
  const playing = useShowStateStore((state) => state.state.playbackStatus === 'playing')

  const mine = settings.hosts?.find((host) => host.equipmentId === boxId)

  async function setRole(role: 'primary' | 'backup') {
    const address = await promptText(t(role === 'primary' ? 'hostRole.askPrimary' : 'hostRole.askBackup'), {
      label: t('hostRole.address'),
      // The paired host is the natural primary; a backup is another machine, so nothing to suggest.
      defaultValue: role === 'primary' ? (getHostUrl() ?? '') : '',
      submitLabel: t('hostRole.check'),
    })
    if (address === null) return
    const host = await fetchBandHost(address)
    if (!host) {
      await alert(t('hostRole.notReached'), { title: t('hostRole.title') })
      return
    }
    await save({ ...settings, hosts: assignHostRole(settings.hosts, { ...host, equipmentId: boxId }, role) })
  }

  async function removeRole() {
    if (mine) await save({ ...settings, hosts: removeHostRole(settings.hosts, mine.hostId) })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold">{t('hostRole.title')}</span>
        {mine ? <Badge tone="accent">{t(mine.priority === 1 ? 'hostRole.primary' : 'hostRole.backup')}</Badge> : <span className="text-base text-ink-muted">{t('hostRole.none')}</span>}
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={playing} onClick={() => void setRole('primary')}>{t('hostRole.setPrimary')}</Button>
          <Button disabled={playing} onClick={() => void setRole('backup')}>{t('hostRole.setBackup')}</Button>
          {mine && <Button variant="quiet" disabled={playing} onClick={() => void removeRole()}>{t('hostRole.remove')}</Button>}
          {playing && <span className="text-base text-ink-muted">{t('hostRole.locked')}</span>}
        </div>
      )}
    </div>
  )
}
