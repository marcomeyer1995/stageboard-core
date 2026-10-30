import i18n from '../i18n'
import { useEffect, useState } from 'react'
import { getStageServerUrl } from '../lib/stageServer'
import { useTranslation } from 'react-i18next'

interface BackupStatus {
  ok: boolean
  at?: string
  target?: string | null
  error?: string
  totalBytes?: number
}

/** How long ago, in words a musician reads at a glance. */
function ago(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000)
  if (minutes < 60) return i18n.t('devices:backup.minutes', { n: Math.max(1, minutes) })
  const hours = Math.round(minutes / 60)
  if (hours < 48) return i18n.t('devices:backup.hours', { n: hours })
  return i18n.t('devices:backup.days', { n: Math.round(hours / 24) })
}

/**
 * "Letztes Backup" of the Stage-Server (#363), from scripts/backup.mjs' status file: green when
 * the last run worked (and is younger than two days), red with the reason when it failed or is
 * stale, a hint when backups were never set up.
 */
export function BackupStatusLine() {
  const { t } = useTranslation('devices')
  const [status, setStatus] = useState<BackupStatus | null | undefined>(undefined)

  useEffect(() => {
    const base = getStageServerUrl()
    if (!base) return
    let cancelled = false
    fetch(`${base}/server/backup-status`)
      .then((res) => (res.ok ? (res.json() as Promise<BackupStatus | null>) : undefined))
      .then((value) => {
        if (!cancelled) setStatus(value)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (status === undefined) return null
  if (status === null) return <span className="text-warn">{t('backup.notSetUp')}</span>
  const stale = status.at ? Date.now() - new Date(status.at).getTime() > 48 * 3600_000 : true
  if (!status.ok) return <span className="text-danger">{t('backup.failed', { when: status.at ? ` (${ago(status.at)})` : '', error: status.error })}</span>
  return (
    <span className={stale ? 'text-warn' : 'text-ok'}>
      {t('backup.last', { when: status.at ? ago(status.at) : '' })}
      {stale ? t('backup.stale') : ''}
    </span>
  )
}
