import i18n from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { DEVICE_INFO_TIMEOUT_MS, SERVER_EXECUTION_TARGET, type Device, type LogicalDevice } from 'shared-types'
import { getServerTime } from '../lib/clockSync'
import { useNow } from '../lib/useNow'
import { useStageServerStatus } from '../lib/useStageServerStatus'
import { useDeviceInfoStore } from '../store/useDeviceInfoStore'
import { useDevicesStore } from '../store/useDevicesStore'
import { useDialogStore } from '../store/useDialogStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { getDeviceId } from '../lib/deviceId'
import { ActionMenu, Badge, Button, InfoHint } from './ui'
import { BackupStatusLine } from './BackupStatusLine'
import { BUILT_IN_OUTPUTS, builtInRoles } from './BuiltInOutputs'
import { LatencyProfileDialog, LatencySummary } from './LatencyProfiles'
import { useTranslation } from 'react-i18next'

/** How long the Stage-Server has to collect reports before a missing one means "inactive". */
const COLLECT_MS = 5 * 60 * 1000
/** Fallback for an older server (no `collectingSince`): seen this recently = not inactive. */
const RECENT_MS = 24 * 60 * 60 * 1000

const ENVIRONMENTS = ['browser', 'pwa', 'native'] as const
const SYNC_STATES = ['idle', 'syncing', 'offline', 'error'] as const

/** `ms` can be missing on a doc written before `firstSeenAt` existed (Device Ledger,
 * 2026-09-08) - that device backfills it on its own next launch (useDevicesStore.ts's `init()`),
 * but until then (or for a device that never launches again) this reads "unbekannt" rather than
 * "Invalid Date". */
function formatDateTime(ms: number | undefined): string {
  if (!ms) return i18n.t('devices:unknown')
  return new Date(ms).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
}

function StatusDot({ on, title }: { on: boolean | null; title: string }) {
  const color = on === null ? 'bg-ink-faint/40' : on ? 'bg-ok' : 'bg-ink-faint'
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
  const { t } = useTranslation('devices')
  const devices = useDevicesStore((state) => state.devices)
  const revoke = useDevicesStore((state) => state.revoke)
  const forget = useDevicesStore((state) => state.forget)
  const logicalDevices = useLogicalDevicesStore((state) => state.devices)
  const deviceInfo = useDeviceInfoStore((state) => state.deviceInfo)
  const deviceInfoLoaded = useDeviceInfoStore((state) => state.loaded)
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const isAdmin = useWorkspaceStore((state) => state.workspaces.find((w) => w.id === activeWorkspaceId)?.isAdmin ?? false)
  const confirm = useDialogStore((state) => state.confirm)
  // Latency entry (#491): which device's dialog is open - a tablet, or the Stage-Server.
  const [latencyFor, setLatencyFor] = useState<{ id: string; name: string } | null>(null)

  // Opens the live diagnostic SSE subscription only while this screen is actually mounted (see
  // useDeviceInfoStore.ts's own doc comment for why this isn't wired always-on in App.tsx).
  useEffect(() => {
    if (!activeWorkspaceId) return
    void useDeviceInfoStore.getState().init(activeWorkspaceId)
    return () => useDeviceInfoStore.getState().stop()
  }, [activeWorkspaceId])
  const alert = useDialogStore((state) => state.alert)
  const now = useNow()
  const stageServer = useStageServerStatus()

  async function toggleRevoked(device: Device) {
    const nextRevoked = !device.revoked
    if (nextRevoked) {
      const confirmed = await confirm(t('blockConfirm', { name: device.name }), {
        confirmLabel: t('block'),
        danger: true,
      })
      if (!confirmed) return
    }
    const ok = await revoke(activeWorkspaceId, device.id, nextRevoked)
    if (!ok) void alert(t('notPossible'))
  }

  const sorted = [...devices].sort((a, b) => b.lastSeenAt - a.lastSeenAt)
  const myId = getDeviceId()
  /** Hardware that runs on a device (Hardware tab, `executionTarget`) - such a device is never
   * removed (Marco, 2026-10-07); the row names what has to move first. */
  const usedBy = (deviceId: string) => logicalDevices.filter((d) => d.executionTarget === deviceId).map(displayName)
  /** Klick / Backing-Track / Ansagen by the name Bühnentechnik shows - old roles still carry their
   * plugin-era names "Click", "Mock Playback" (Marco, 2026-10-17). */
  const builtIn = builtInRoles(logicalDevices)
  function displayName(device: LogicalDevice): string {
    if (!builtIn.includes(device)) return device.name
    return BUILT_IN_OUTPUTS.find((output) => output.capability === device.capability)?.label ?? device.name
  }
  /** Live signal (app open or reachable). Right after a Stage-Server start no device has reported
   * yet - then every device would look inactive (found on the real server, 2026-10-07), so
   * missing reports only count once the server has collected for a while; an older server
   * without `collectingSince` falls back to "not seen for a day". */
  // `collectingSince` and the reports' `lastSeenAt` are the Stage-Server's clock - compared in
  // server time, so a tablet clock that is off doesn't shift the window (#426 review).
  const serverNow = now - Date.now() + getServerTime()
  const collectedLongEnough = deviceInfo.collectingSince !== undefined && serverNow - deviceInfo.collectingSince >= COLLECT_MS
  const isActive = (device: Device) => {
    const info = deviceInfo.devices[device.id]
    if (info && (serverNow - info.lastSeenAt <= DEVICE_INFO_TIMEOUT_MS || info.networkReachable === true)) return true
    if (collectedLongEnough) return false
    return deviceInfo.collectingSince !== undefined || now - device.lastSeenAt < RECENT_MS
  }
  /** What "Inaktive entfernen" takes: no app open and not reachable, not blocked (the block lives
   * on the entry), not this device, not in use by hardware. */
  // Nothing counts as inactive before the first device report arrived.
  const inactive = deviceInfoLoaded ? sorted.filter((d) => !d.revoked && d.id !== myId && !isActive(d) && usedBy(d.id).length === 0) : []
  const skippedInUse = deviceInfoLoaded ? sorted.filter((d) => !d.revoked && d.id !== myId && !isActive(d) && usedBy(d.id).length > 0) : []
  // The list as of now - read again after the confirmation, which can take a while.
  const inactiveNow = useRef(inactive)
  inactiveNow.current = inactive

  async function forgetOne(device: Device) {
    if (!(await confirm(t('forgetConfirm', { name: device.name }), { confirmLabel: t('remove') }))) return
    const result = await forget(activeWorkspaceId, device.id)
    if (result === 'in-use') void alert(t('inUse', { name: device.name }))
    else if (result === 'blocked') void alert(t('blocked', { name: device.name }))
    else if (result === 'failed') void alert(t('notPossible'))
  }

  async function forgetInactive() {
    const note = skippedInUse.length ? t('skipNote', { count: skippedInUse.length }) : ''
    if (!(await confirm(t('forgetInactiveConfirm', { count: inactive.length, note }), { confirmLabel: t('remove') }))) return
    // Only devices that were confirmed AND are still inactive - one that came back online or was
    // blocked while the question was open stays (#426 review).
    const confirmed = new Set(inactive.map((device) => device.id))
    let failed = 0
    for (const device of inactiveNow.current.filter((d) => confirmed.has(d.id))) if ((await forget(activeWorkspaceId, device.id)) !== 'removed') failed++
    if (failed) void alert(t('forgetFailed', { count: failed }))
  }

  return (
    <div className="h-full overflow-y-auto sb-app-bg p-4 text-ink">
      <div className="mb-4 flex items-center gap-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <InfoHint
          label={t('explainLabel')}
          text={t('explain')}
        />
      </div>

      {/* The Stage-Server itself, not a roster `Device` (it never joins a band, it hosts one) -
          its own row, same visual language as the tablets below, so "is anything down" reads
          the same way for the box everything else here depends on. */}
      <div className="mb-2 rounded-container border border-line bg-surface px-4 py-3 shadow-sb">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="font-semibold">{t('server')}</p>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
          <span className="flex items-center gap-1.5">
            <StatusDot on={stageServer.status === 'loading' ? null : stageServer.status === 'reachable'} title={t('reachable')} />
            {t('reachable')}
          </span>
          {stageServer.status === 'reachable' ? (
            <>
              <span>
                {t('ip', { ip: stageServer.lanIp })}
                {stageServer.hostname && <span className="text-ink-faint"> ({stageServer.hostname})</span>}
              </span>
              <span>{t('server')}</span>
              <span>{t('activeBand', { band: stageServer.activeWorkspaceName ?? stageServer.activeWorkspaceId ?? t('none') })}</span>
              <BackupStatusLine />
            </>
          ) : (
            <span className="text-ink-faint">
              {stageServer.status === 'loading' ? (stageServer.slow ? t('slow') : t('loading')) : t('noConnection')}
            </span>
          )}
        </div>
        <LatencySummary deviceId={SERVER_EXECUTION_TARGET} />
        {isAdmin && (
          <Button className="mt-2" onClick={() => setLatencyFor({ id: SERVER_EXECUTION_TARGET, name: t('server') })}>
            {t('latency')}
          </Button>
        )}
      </div>

      {sorted.length === 0 && <p className="text-sm text-ink-faint">{t('noDevices')}</p>}

      {isAdmin && sorted.length > 0 && (
        <div className="mb-3 flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <Button disabled={inactive.length === 0} onClick={() => void forgetInactive()}>
              {t('forgetInactive', { count: inactive.length })}
            </Button>
            <InfoHint
              label={t('forgetInactiveLabel')}
              text={t('forgetInactiveInfo')}
            />
          </div>
          <p className="text-sm text-ink-faint empty:hidden">
            {skippedInUse.length > 0 && t('keptInUse', { count: skippedInUse.length })}
            {deviceInfo.collectingSince !== undefined && !collectedLongEnough && t('justStarted')}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {sorted.map((device) => {
          const info = deviceInfo.devices[device.id]
          const appOpen = info ? now - info.lastSeenAt <= DEVICE_INFO_TIMEOUT_MS : false
          const used = usedBy(device.id)

          return (
            <div key={device.id} className={`rounded-container border px-4 py-3 shadow-sb ${device.revoked ? 'border-danger/40 bg-danger/5' : 'border-line bg-surface'}`}>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {device.name}
                    {device.revoked && (
                      <span className="ml-2">
                        <Badge tone="danger">{t('blockedBadge')}</Badge>
                      </span>
                    )}
                    {device.id === myId && (
                      <span className="ml-2">
                        <Badge tone="accent">{t('thisDevice')}</Badge>
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-ink-faint">
                    {t('seen', { first: formatDateTime(device.firstSeenAt), last: formatDateTime(device.lastSeenAt) })}
                  </p>
                </div>
                {(isAdmin || device.id === myId) && (
                  <ActionMenu
                    title={device.name}
                    actions={[
                      { label: t('latency'), onClick: () => setLatencyFor({ id: device.id, name: device.name }) },
                      ...(!isAdmin ? [] : !device.revoked && device.id !== myId
                        ? [{ label: t('forget'), disabled: used.length > 0, onClick: () => void forgetOne(device) }]
                        : []),
                      ...(!isAdmin
                        ? []
                        : [
                            device.revoked
                              ? { label: t('allow'), onClick: () => void toggleRevoked(device) }
                              : { label: t('block'), danger: true, disabled: device.id === myId, onClick: () => void toggleRevoked(device) },
                          ]),
                    ]}
                  />
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
                <span className="flex items-center gap-1.5">
                  <StatusDot on={info ? appOpen : null} title={appOpen ? t('appOpen') : t('appClosed')} />
                  {t('appOpen')}
                </span>
                <span className="flex items-center gap-1.5">
                  <StatusDot on={info?.networkReachable ?? null} title={t('reachable')} />
                  {t('reachable')}
                </span>
                {info ? (
                  <>
                    <span>
                      {t('ip', { ip: info.ip })}
                      {info.hostname && <span className="text-ink-faint"> ({info.hostname})</span>}
                    </span>
                    <span>{info.os}</span>
                    <span>{(ENVIRONMENTS as readonly string[]).includes(info.environment) ? t(`env.${info.environment as (typeof ENVIRONMENTS)[number]}`) : info.environment}</span>
                    <span>{(SYNC_STATES as readonly string[]).includes(info.syncStatus) ? t(`sync.${info.syncStatus as (typeof SYNC_STATES)[number]}`) : info.syncStatus}</span>
                  </>
                ) : (
                  <span className="text-ink-faint">{t('noData')}</span>
                )}
              </div>
              <LatencySummary deviceId={device.id} />
              {used.length > 0 && (
                <p className="mt-2 text-sm text-warn">
                  {t('inUseBy', { list: used.join(', ') })}
                </p>
              )}
            </div>
          )
        })}
      </div>
      {latencyFor && <LatencyProfileDialog deviceId={latencyFor.id} deviceName={latencyFor.name} onClose={() => setLatencyFor(null)} />}
    </div>
  )
}
