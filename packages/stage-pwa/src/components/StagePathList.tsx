import { useMemo, useState } from 'react'
import { getDeviceId } from '../lib/deviceId'
import { routeLabel } from '../lib/latencyProfiles'
import { stagePaths, type StagePath, type StagePathState } from '../lib/stagePaths'
import { useActiveProfileStore } from '../store/useActiveProfileStore'
import { useDevicesStore } from '../store/useDevicesStore'
import { useLatencyProfilesStore } from '../store/useLatencyProfilesStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { usePresenceStore } from '../store/usePresenceStore'
import { useProfilesStore } from '../store/useProfilesStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { AlignByEarDialog } from './AlignByEarDialog'
import { BUILT_IN_OUTPUTS } from './BuiltInOutputs'
import { LatencyProfileDialog } from './LatencyProfiles'
import { Badge, Button, InfoHint } from './ui'
import { useTranslation } from 'react-i18next'

const STATE_MARK: Record<StagePathState, string> = { measured: '●', manual: '◐', missing: '○' }

/**
 * Die Wege der Bühne (docs/31, Schritt 1): je Gerät seine physischen Wege - der eigene Ton über
 * jede Route, die Ausgänge, die es steuert - mit genau einer Latenz-Korrektur, ihrem Zustand und
 * wer sie nutzt. Dieses Gerät oben und hervorgehoben. Abgleichen/Wert am Weg: jeder an seinem
 * eigenen Platz (dieses Gerät, Geräte mit seinem Profil), der Admin überall, ohne Profil nichts
 * (Marco, 2026-11-05).
 */
export function StagePathList() {
  const { t } = useTranslation('hardware')
  const devices = useDevicesStore((state) => state.devices).filter((d) => !d.revoked)
  const logicalDevices = useLogicalDevicesStore((state) => state.devices)
  const profiles = useLatencyProfilesStore((state) => state.profiles)
  const presence = usePresenceStore((state) => state.presence)
  const people = useProfilesStore((state) => state.profiles)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const isAdmin = useWorkspaceStore((state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.isAdmin ?? false)
  const myProfileId = useActiveProfileStore((state) => state.byWorkspace[workspaceId] ?? '')
  const [aligning, setAligning] = useState<string | null>(null)
  const [valueFor, setValueFor] = useState<{ id: string; name: string } | null>(null)

  const ownId = getDeviceId()
  const groups = useMemo(
    () =>
      stagePaths({
        devices,
        ownDeviceId: ownId,
        logicalDevices,
        profiles,
        builtIn: new Map(BUILT_IN_OUTPUTS.map((output) => [output.capability, output.label])),
        personAt: (id) => {
          const profileId = presence.devices[id]?.profileId
          return people.find((p) => p.id === profileId)?.name ?? null
        },
        serverName: t('stage.server'),
      }),
    [devices, ownId, logicalDevices, profiles, presence, people, t],
  )

  const canEdit = (deviceId: string) => myProfileId !== '' && (isAdmin || deviceId === ownId || presence.devices[deviceId]?.profileId === myProfileId)

  const label = (path: StagePath) => (path.kind === 'audio' && path.route ? t('stage.sound', { route: routeLabel(path.route) }) : (path.name ?? ''))
  const users = (path: StagePath) => [path.roles.join(', '), path.person].filter(Boolean).join(' → ')

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center gap-1">
        <h2 className="text-xl font-bold">{t('stage.title')}</h2>
        <InfoHint label={t('stage.explainLabel')} text={t('stage.explain')} />
      </div>
      {myProfileId === '' && <p className="mb-3 text-base text-ink-muted">{t('stage.viewOnly')}</p>}
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.deviceId} className={`rounded-container border p-3 ${group.own ? 'border-accent' : 'border-line'}`}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-lg font-bold">{group.name}</span>
              {group.own && <Badge tone="accent">{t('stage.thisDevice')}</Badge>}
            </div>
            {group.paths.length === 0 ? (
              <p className="text-base text-ink-faint">{t('stage.noPaths')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {group.paths.map((path) => (
                  <li key={path.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {/* On a phone the name gets its own line, value and button below (it wrapped word by word). */}
                    <span className="flex min-w-0 basis-full items-baseline gap-3 sm:basis-0 sm:flex-1">
                      <span className={`w-5 flex-shrink-0 text-center text-lg ${path.state === 'missing' ? 'text-ink-faint' : 'text-accent'}`} title={t(`stage.state.${path.state}`)}>
                        {STATE_MARK[path.state]}
                      </span>
                      <span className="min-w-0 text-base">
                        {label(path)}
                        {users(path) && <span className="text-ink-muted"> · {users(path)}</span>}
                      </span>
                    </span>
                    <span className="ml-8 w-16 text-right text-base tabular-nums sm:ml-0">{path.latencyMs === null ? '–' : `${path.latencyMs} ms`}</span>
                    {canEdit(group.deviceId) &&
                      (path.kind === 'audio' ? (
                        <Button onClick={() => setAligning(group.deviceId)}>{t('stage.align')}</Button>
                      ) : (
                        <Button onClick={() => setValueFor({ id: group.deviceId, name: group.name })}>{t('stage.value')}</Button>
                      ))}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {aligning && <AlignByEarDialog targetDeviceId={aligning} onClose={() => setAligning(null)} />}
      {valueFor && <LatencyProfileDialog deviceId={valueFor.id} deviceName={valueFor.name} onClose={() => setValueFor(null)} />}
    </section>
  )
}
