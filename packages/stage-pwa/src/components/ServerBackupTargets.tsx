import { useCallback, useEffect, useState } from 'react'
import { BackupTargetSchema, type BackupOverview, type BackupTarget } from 'shared-types'
import { getStageServerUrl } from '../lib/stageServer'
import { useDialogStore } from '../store/useDialogStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { AddRow, Button, Card, Dialog, Field, Section, Segmented, StatusDot, Switch } from './ui'

/** How long ago, in words. */
function ago(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000)
  if (minutes < 60) return `vor ${Math.max(1, minutes)} Min.`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `vor ${hours} Std.`
  return `vor ${Math.round(hours / 24)} Tagen`
}

function size(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1).replace('.', ',')} GB`
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`
}

const NEW_TARGET = (kind: BackupTarget['kind']): BackupTarget => ({
  id: crypto.randomUUID(),
  name: kind === 'folder' ? 'USB-Stick' : 'NAS',
  kind,
  path: kind === 'folder' ? '' : undefined,
  host: kind === 'ssh' ? '' : undefined,
  port: kind === 'ssh' ? 22 : undefined,
  user: kind === 'ssh' ? '' : undefined,
  remotePath: kind === 'ssh' ? '' : undefined,
  keep: 7,
  dailyAt: '04:00',
  onPlugIn: kind === 'folder',
  enabled: true,
})

/**
 * Where the Stage-Server backs itself up (#363, Marco 2026-10-08): one or several targets - a
 * folder (USB stick, second disk, ZFS, an OS-mounted NAS share) or a NAS over SSH. The server runs
 * them itself: daily at a time and when the stick is plugged in. Only for an admin of the band
 * this server serves (the server checks the admin login again).
 */
export function ServerBackupTargets() {
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId))
  const alert = useDialogStore((s) => s.alert)
  const confirm = useDialogStore((s) => s.confirm)
  const [overview, setOverview] = useState<BackupOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<BackupTarget | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const call = useCallback(
    async (path: string, extra: object = {}): Promise<unknown> => {
      const base = getStageServerUrl()
      if (!base || !workspace?.username || !workspace.couchPassword) throw new Error('Kein Stage-Server oder keine Admin-Anmeldung auf diesem Gerät.')
      const res = await fetch(`${base}/server/backup/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminUsername: workspace.username, adminPassword: workspace.couchPassword, ...extra }),
      })
      const body = (await res.json().catch(() => null)) as { message?: string } | null
      if (!res.ok) throw new Error(body?.message ?? `Stage-Server antwortet mit ${res.status}`)
      return body
    },
    [workspace?.username, workspace?.couchPassword],
  )

  const reload = useCallback(() => {
    call('overview')
      .then((o) => {
        setOverview(o as BackupOverview)
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [call])

  useEffect(() => {
    reload()
    // While a backup runs, the status follows it.
    const timer = setInterval(reload, 5000)
    return () => clearInterval(timer)
  }, [reload])

  if (!workspace?.isAdmin) return null

  async function save(target: BackupTarget) {
    try {
      setOverview((await call('save', { target })) as BackupOverview)
      setEditing(null)
    } catch (err) {
      void alert(`Nicht gespeichert: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function remove(target: BackupTarget) {
    if (!(await confirm(`Ziel „${target.name}“ entfernen? Die Sicherungen dort bleiben liegen.`, { confirmLabel: 'Entfernen' }))) return
    try {
      setOverview((await call('delete', { targetId: target.id })) as BackupOverview)
      setEditing(null)
    } catch (err) {
      void alert(`Nicht entfernt: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function test(target: BackupTarget) {
    setBusy(target.id)
    try {
      const r = (await call('test', { targetId: target.id })) as { ok: boolean; message: string }
      void alert(r.ok ? `✓ ${r.message}` : `Geht nicht: ${r.message}`)
    } catch (err) {
      void alert(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function runNow(target: BackupTarget) {
    try {
      await call('run', { targetId: target.id })
      reload()
    } catch (err) {
      void alert(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Section
        title="Sicherung des Stage-Servers"
        hint="Am sichersten zwei Ziele, z. B. USB-Stick und NAS. Ein ZFS-Spiegel allein ist keine Sicherung: Gelöschtes ist auch auf dem Spiegel weg."
      >
        {error && <p className="text-sm text-danger">{error}</p>}
        {overview?.targets.length === 0 && <p className="text-sm text-ink-faint">Noch kein Ziel eingerichtet - der Server sichert sich nicht.</p>}
        {overview?.targets.map(({ target, status }) => {
          const missing = status.present === false
          const dot = !target.enabled ? 'off' : status.lastError ? 'error' : missing || !status.lastSuccessAt ? 'warning' : 'ok'
          const when = [target.dailyAt ? `täglich ${target.dailyAt}` : null, target.onPlugIn ? 'beim Einstecken' : null].filter(Boolean).join(' · ')
          return (
            <Card key={target.id}>
              <div className="flex flex-wrap items-center gap-3">
                <StatusDot status={dot} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold">{target.name}</p>
                  <p className="truncate text-sm text-ink-faint">
                    {target.kind === 'folder' ? target.path : `${target.user}@${target.host}:${target.remotePath}`}
                    {when ? ` · ${when}` : ''}
                  </p>
                  <p className={`text-sm ${status.lastError ? 'text-danger' : 'text-ink-muted'}`}>
                    {status.running
                      ? 'Sichert gerade…'
                      : status.lastError
                        ? `Fehlgeschlagen${status.lastRunAt ? ` (${ago(status.lastRunAt)})` : ''}: ${status.lastError}`
                        : status.lastSuccessAt
                          ? `Letzte Sicherung ${ago(status.lastSuccessAt)}${status.lastBytes ? `, ${size(status.lastBytes)}` : ''}`
                          : 'Noch keine Sicherung'}
                    {missing && !status.running ? ' · Medium nicht eingesteckt' : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void test(target)} disabled={busy === target.id}>
                    {busy === target.id ? 'Prüfe…' : 'Testen'}
                  </Button>
                  <Button variant="primary" onClick={() => void runNow(target)} disabled={status.running || missing}>
                    Jetzt sichern
                  </Button>
                  <Button onClick={() => setEditing(target)}>Bearbeiten</Button>
                </div>
              </div>
            </Card>
          )
        })}
        <AddRow label="Ziel hinzufügen" onClick={() => setEditing(NEW_TARGET('folder'))} />
      </Section>

      {overview?.publicKey && overview.targets.some((t) => t.target.kind === 'ssh') && (
        <Section title="Schlüssel des Servers für die NAS" hint="Einmal auf der NAS beim Backup-Benutzer in ~/.ssh/authorized_keys eintragen - dann braucht der Server kein Passwort.">
          <code className="block select-all break-all rounded-control border border-line bg-control p-3 text-sm">{overview.publicKey}</code>
          <div>
            <Button onClick={() => void navigator.clipboard?.writeText(overview.publicKey!).then(() => alert('Schlüssel kopiert.'))}>Kopieren</Button>
          </div>
        </Section>
      )}

      {editing && (
        <TargetDialog
          target={editing}
          isNew={!overview?.targets.some((t) => t.target.id === editing.id)}
          onSave={(t) => void save(t)}
          onRemove={() => void remove(editing)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function TargetDialog({ target, isNew, onSave, onRemove, onClose }: { target: BackupTarget; isNew: boolean; onSave: (t: BackupTarget) => void; onRemove: () => void; onClose: () => void }) {
  const [draft, setDraft] = useState<BackupTarget>(target)
  const set = (patch: Partial<BackupTarget>) => setDraft((d) => ({ ...d, ...patch }))
  const parsed = BackupTargetSchema.safeParse(draft)
  const errorOf = (field: string) => (parsed.success ? undefined : parsed.error.issues.find((i) => i.path[0] === field)?.message)

  function switchKind(kind: BackupTarget['kind']) {
    const fresh = NEW_TARGET(kind)
    setDraft({ ...fresh, id: draft.id, keep: draft.keep, dailyAt: draft.dailyAt, enabled: draft.enabled, name: draft.name === NEW_TARGET(draft.kind).name ? fresh.name : draft.name })
  }

  return (
    <Dialog
      title={isNew ? 'Ziel hinzufügen' : 'Ziel bearbeiten'}
      onClose={onClose}
      actions={
        <>
          {!isNew && (
            <Button variant="danger" onClick={onRemove}>
              Entfernen
            </Button>
          )}
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!parsed.success} onClick={() => parsed.success && onSave(parsed.data)}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented
          label="Art des Ziels"
          value={draft.kind}
          onChange={switchKind}
          options={[
            { value: 'folder', label: 'Ordner' },
            { value: 'ssh', label: 'NAS über Netzwerk' },
          ]}
        />
        <p className="text-sm text-ink-faint">
          {draft.kind === 'folder'
            ? 'USB-Stick, zweite Festplatte, ZFS-Dataset oder eine vom System eingehängte NAS-Freigabe.'
            : 'Die NAS wird per SSH erreicht (rsync) - nichts einzuhängen. Unveränderte Backing-Tracks belegen keinen Platz doppelt.'}
        </p>
        <Field label="Name" value={draft.name} onChange={(e) => set({ name: e.target.value })} error={errorOf('name')} />
        {draft.kind === 'folder' ? (
          <Field label="Ordner" placeholder="/media/marco/BACKUP" value={draft.path ?? ''} onChange={(e) => set({ path: e.target.value })} error={errorOf('path')} />
        ) : (
          <>
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <Field label="Adresse der NAS" placeholder="nas.local" value={draft.host ?? ''} onChange={(e) => set({ host: e.target.value })} error={errorOf('host')} />
              <Field label="Port" type="number" inputMode="numeric" value={draft.port ?? 22} onChange={(e) => set({ port: Number(e.target.value) || 22 })} />
            </div>
            <Field label="Benutzer" placeholder="backup" value={draft.user ?? ''} onChange={(e) => set({ user: e.target.value })} error={errorOf('user')} />
            <Field label="Ordner auf der NAS" placeholder="/volume1/stageboard" value={draft.remotePath ?? ''} onChange={(e) => set({ remotePath: e.target.value })} error={errorOf('remotePath')} />
          </>
        )}
        <Switch label="Täglich sichern" checked={draft.dailyAt !== null} onChange={(on) => set({ dailyAt: on ? '04:00' : null })} description="Nie während ein Song läuft - dann kurz danach." />
        {draft.dailyAt !== null && <Field label="Uhrzeit" type="time" value={draft.dailyAt} onChange={(e) => set({ dailyAt: e.target.value || '04:00' })} error={errorOf('dailyAt')} />}
        {draft.kind === 'folder' && (
          <Switch label="Beim Einstecken sichern" checked={draft.onPlugIn} onChange={(on) => set({ onPlugIn: on })} description="Sobald der Stick da ist, wenn die letzte Sicherung älter als einen Tag ist." />
        )}
        <Field
          label="Sicherungen behalten"
          type="number"
          inputMode="numeric"
          min={1}
          max={60}
          value={draft.keep}
          onChange={(e) => set({ keep: Math.min(60, Math.max(1, Number(e.target.value) || 1)) })}
          hint="Ältere werden gelöscht."
        />
        <Switch label="Aktiv" checked={draft.enabled} onChange={(on) => set({ enabled: on })} />
      </div>
    </Dialog>
  )
}
