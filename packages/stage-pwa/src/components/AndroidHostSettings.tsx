import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { startAndroidHost, stopAndroidHost } from '../host/localHost'
import { useAndroidHostStore } from '../store/useAndroidHostStore'
import { Button } from './ui'

/**
 * "This tablet as a host" (host backup, #947, docs/25 §6g): the switch starts the native web
 * server; the tablet then waits as the band's **backup** and takes over when the primary stays
 * away. Nothing else to type here - the band's stage map names either host by its address, and the
 * primary teaches the tablet its band (#945). Native app only; the page hides the group elsewhere.
 */
export function AndroidHostSettings() {
  const { t } = useTranslation('system')
  const status = useAndroidHostStore()
  const [busy, setBusy] = useState(false)
  const toggle = async () => {
    setBusy(true)
    try {
      if (status.running) await stopAndroidHost()
      else await startAndroidHost()
    } finally {
      setBusy(false)
    }
  }
  const lease = status.lease
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-muted">{t('server.hostInfo')}</p>
      <Button disabled={busy} onClick={() => void toggle()}>
        {status.running ? t('server.hostStop') : t('server.hostStart')}
      </Button>
      {status.error !== null && <p className="text-sm text-danger">{status.error}</p>}
      {status.running && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-muted">{t('server.hostAddress')}</dt>
          <dd className="text-ink">{status.url ?? '–'}</dd>
          <dt className="text-ink-muted">{t('server.hostEpoch')}</dt>
          <dd className="text-ink">{status.epoch}</dd>
          <dt className="text-ink-muted">{t('server.hostRole')}</dt>
          <dd className="text-ink">
            {status.priority === null ? t('server.hostNotListed') : status.outdated ? t('server.hostOutdated') : status.priority === 1 ? t('server.hostPrimary') : status.active ? t('server.hostActive') : t('server.hostBackup')}
          </dd>
          <dt className="text-ink-muted">{t('server.hostLease')}</dt>
          <dd className="text-ink">
            {lease === null
              ? t('server.hostNoLease')
              : lease.alive
                ? t('server.hostLeaseAlive', { host: lease.hostId, epoch: lease.epoch })
                : t('server.hostLeaseSilent', { seconds: (lease.silentForMs / 1000).toFixed(0) })}
          </dd>
        </dl>
      )}
    </div>
  )
}
