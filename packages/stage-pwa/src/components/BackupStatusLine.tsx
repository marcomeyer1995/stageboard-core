import { useEffect, useState } from 'react'
import { getStageServerUrl } from '../lib/stageServer'

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
  if (minutes < 60) return `vor ${Math.max(1, minutes)} Min.`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `vor ${hours} Std.`
  return `vor ${Math.round(hours / 24)} Tagen`
}

/**
 * "Letztes Backup" of the Stage-Server (#363), from scripts/backup.mjs' status file: green when
 * the last run worked (and is younger than two days), red with the reason when it failed or is
 * stale, a hint when backups were never set up.
 */
export function BackupStatusLine() {
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
  if (status === null) return <span className="text-amber-500">Backup: noch nicht eingerichtet (docs/03 „Backup“)</span>
  const stale = status.at ? Date.now() - new Date(status.at).getTime() > 48 * 3600_000 : true
  if (!status.ok) return <span className="text-red-400">Backup fehlgeschlagen{status.at ? ` (${ago(status.at)})` : ''}: {status.error}</span>
  return (
    <span className={stale ? 'text-amber-500' : 'text-green-500'}>
      Letztes Backup {status.at ? ago(status.at) : ''}
      {stale ? ' - älter als zwei Tage' : ''}
    </span>
  )
}
