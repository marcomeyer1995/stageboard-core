import { useEffect } from 'react'
import { DEVICE_INFO_TIMEOUT_MS, type Device } from 'shared-types'
import { useNow } from '../lib/useNow'
import { useDeviceInfoStore } from '../store/useDeviceInfoStore'
import { useDevicesStore } from '../store/useDevicesStore'
import { useDialogStore } from '../store/useDialogStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

const ENVIRONMENT_LABEL: Record<string, string> = { browser: 'Browser', pwa: 'PWA', native: 'Nativ' }
const SYNC_STATUS_LABEL: Record<string, string> = { idle: 'Synchronisiert', syncing: 'Synchronisiert…', offline: 'Offline', error: 'Fehler' }

/** `ms` can be missing on a doc written before `firstSeenAt` existed (Device Ledger,
 * 2026-09-08) - that device backfills it on its own next launch (useDevicesStore.ts's `init()`),
 * but until then (or for a device that never launches again) this reads "unbekannt" rather than
 * "Invalid Date". */
function formatDateTime(ms: number | undefined): string {
  if (!ms) return 'unbekannt'
  return new Date(ms).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
}

function StatusDot({ on, title }: { on: boolean | null; title: string }) {
  const color = on === null ? 'bg-ink-faint/40' : on ? 'bg-green-500' : 'bg-ink-faint'
  return <span className={`inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${color}`} title={title} />
}

/**
 * The Device Ledger (Marco, explicit request) - "first point to check stuff if something is not
 * properly running": every device that ever joined this workspace, in one place, with enough
 * live detail to tell apart "tablet dropped off WiFi" from "tablet's on the network but the app
 * got closed" from "everything's fine, just hasn't synced in a while."
 *
 * Two independent live signals per row, deliberately not merged into one (see deviceInfo.ts's
 * doc comment): "App offen" from `useDeviceInfoStore`'s own report freshness (conceptually the
 * same underlying heartbeat idea as BandManagementView.tsx's per-member green dots, just shown
 * per-device instead of aggregated per-profile - not a second, redundant mechanism, the same
 * kind of signal read at a different granularity), and "Netzwerk erreichbar" from the
 * Stage-Server's own background ping loop (pingLoop.ts) - a real ICMP check no browser could
 * ever do itself.
 *
 * Kick/restore (`revoked`) is admin-gated the same way every other destructive/administrative
 * action in BandManagementView.tsx is: a local `isAdmin` check for the button itself, the real
 * enforcement happening server-side (verifyAdmin), a 403 surfaced via `useDialogStore().alert`
 * as the backstop for the rare case those two disagree (e.g. this device was just demoted).
 */
export function DeviceLedgerView() {
  const devices = useDevicesStore((state) => state.devices)
  const revoke = useDevicesStore((state) => state.revoke)
  const deviceInfo = useDeviceInfoStore((state) => state.deviceInfo)
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const isAdmin = useWorkspaceStore((state) => state.workspaces.find((w) => w.id === activeWorkspaceId)?.isAdmin ?? false)
  const confirm = useDialogStore((state) => state.confirm)

  // Opens the live diagnostic SSE subscription only while this screen is actually mounted (see
  // useDeviceInfoStore.ts's own doc comment for why this isn't wired always-on in App.tsx).
  useEffect(() => {
    if (!activeWorkspaceId) return
    void useDeviceInfoStore.getState().init(activeWorkspaceId)
    return () => useDeviceInfoStore.getState().stop()
  }, [activeWorkspaceId])
  const alert = useDialogStore((state) => state.alert)
  const now = useNow()

  async function toggleRevoked(device: Device) {
    const nextRevoked = !device.revoked
    if (nextRevoked) {
      const confirmed = await confirm(`"${device.name}" aus der Band entfernen? Das Gerät wird beim nächsten Kontakt gesperrt.`, {
        confirmLabel: 'Entfernen',
        danger: true,
      })
      if (!confirmed) return
    }
    const ok = await revoke(activeWorkspaceId, device.id, nextRevoked)
    if (!ok) void alert('Aktion nicht möglich - keine Admin-Rechte oder Stage-Server nicht erreichbar.')
  }

  const sorted = [...devices].sort((a, b) => b.lastSeenAt - a.lastSeenAt)

  return (
    <div className="h-dvh overflow-y-auto sb-app-bg p-4 text-ink">
      <h1 className="mb-1 text-2xl font-bold">Geräte</h1>
      <p className="mb-4 text-sm text-ink-muted">
        Jedes Gerät, das dieser Band jemals beigetreten ist. „App offen“ und „Netzwerk erreichbar“
        sind zwei unabhängige Signale - ein Gerät kann im Netzwerk erreichbar sein, ohne dass die
        App gerade läuft, oder umgekehrt gerade das Netzwerk gewechselt haben.
      </p>

      {sorted.length === 0 && <p className="text-sm text-ink-faint">Noch keine Geräte registriert.</p>}

      <div className="flex flex-col gap-2">
        {sorted.map((device) => {
          const info = deviceInfo.devices[device.id]
          const appOpen = info ? now - info.lastSeenAt <= DEVICE_INFO_TIMEOUT_MS : false

          return (
            <div key={device.id} className={`rounded-sb border px-4 py-3 shadow-sb ${device.revoked ? 'border-red-500/40 bg-red-500/5' : 'border-line bg-surface'}`}>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="font-semibold">
                    {device.name}
                    {device.revoked && <span className="ml-2 text-xs font-normal text-red-500">entfernt</span>}
                  </p>
                  <p className="text-xs text-ink-faint">
                    Zuerst gesehen {formatDateTime(device.firstSeenAt)} · Zuletzt {formatDateTime(device.lastSeenAt)}
                  </p>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => void toggleRevoked(device)}
                    className={`rounded-sb-sm px-3 py-1 text-xs font-medium ${
                      device.revoked ? 'bg-control-strong text-accent hover:bg-control-strong-hover' : 'bg-control text-ink-soft hover:bg-control-hover'
                    }`}
                  >
                    {device.revoked ? 'Wieder zulassen' : 'Entfernen'}
                  </button>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
                <span className="flex items-center gap-1.5">
                  <StatusDot on={info ? appOpen : null} title={appOpen ? 'App offen' : 'App geschlossen / nicht gemeldet'} />
                  App offen
                </span>
                <span className="flex items-center gap-1.5">
                  <StatusDot on={info?.networkReachable ?? null} title="Netzwerk erreichbar" />
                  Netzwerk erreichbar
                </span>
                {info ? (
                  <>
                    <span>
                      IP {info.ip}
                      {info.hostname && <span className="text-ink-faint"> ({info.hostname})</span>}
                    </span>
                    <span>{info.os}</span>
                    <span>{ENVIRONMENT_LABEL[info.environment] ?? info.environment}</span>
                    <span>{SYNC_STATUS_LABEL[info.syncStatus] ?? info.syncStatus}</span>
                  </>
                ) : (
                  <span className="text-ink-faint">Noch keine Diagnosedaten von diesem Gerät.</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
