import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PortRef, PortUse, StageIssue, WiringCable } from 'shared-types'
import { Badge, Button, StatusDot } from './ui'

/** Plug names for the list - keys without dots (see PortListDialog). */
const PLUG: Record<string, string> = { 'jack-6.3': 'jack-63', 'jack-6.3-ts': 'jack-63-ts', 'jack-3.5': 'jack-35' }

/**
 * "Verkabelung" of a setup (Marco, 2026-11-07): for the technicians - what is wrong (a channel with
 * two cables, a stereo cable into a mono input; since #746 the whole chain: a shorted stereo output,
 * a lost channel, mixing on a device that does not mix), how many channels each device has left, and every
 * physical cable numbered with its plugs and the adapters to pack. Printing/PDF comes later.
 */
export function StageWiring({
  cables,
  issues,
  use,
  nameOf,
  refText,
  signalName,
}: {
  cables: readonly WiringCable[]
  issues: readonly StageIssue[]
  use: readonly PortUse[]
  nameOf: (equipmentId: string) => string
  refText: (ref: PortRef, width?: number) => string
  signalName: (virtualPortId: string) => string
}) {
  const { t } = useTranslation('hardware')
  const [open, setOpen] = useState(false)
  // Red only for what gives a wrong signal; adapters are packing-list entries, not findings.
  const isWarning = (i: StageIssue) => i.kind === 'mono-of-stereo' || i.kind === 'channel-lost'
  const warnings = issues.filter(isWarning)
  const errors = issues.filter((i) => i.kind !== 'adapter' && !isWarning(i))
  const slot = (i: { equipmentId: string; portId: string; channel?: number; pin?: number }) =>
    `${nameOf(i.equipmentId)} · ${refText({ equipmentId: i.equipmentId, portId: i.portId, ...(i.channel !== undefined ? { channel: i.channel } : {}), ...(i.pin !== undefined ? { pin: i.pin } : {}) })}`
  const adapters = cables.filter((c) => c.adapter)
  const plug = (c: string) => t(`ports.plug.${(PLUG[c] ?? c) as 'xlr'}`)
  const issueText = (i: StageIssue): string => {
    switch (i.kind) {
      case 'double':
        return t('wiring.double', { where: `${nameOf(i.equipmentId)} · ${refText({ equipmentId: i.equipmentId, portId: i.portId, ...(i.channel !== undefined ? { channel: i.channel } : {}) })}`, n: i.linkIds.length })
      case 'width':
        return t('wiring.width', { where: `${nameOf(i.equipmentId)} · ${refText({ equipmentId: i.equipmentId, portId: i.portId })}`, width: i.width, capacity: i.capacity })
      case 'mono-of-stereo':
        return t('wiring.monoOfStereo', { where: `${nameOf(i.equipmentId)} · ${refText({ equipmentId: i.equipmentId, portId: i.portId })}` })
      case 'mono-in-stereo-out':
        return t('wiring.monoInStereoOut', { where: `${nameOf(i.equipmentId)} · ${refText({ equipmentId: i.equipmentId, portId: i.portId })}` })
      case 'channel-lost':
        return t('wiring.channelLost', { where: slot(i), signal: signalName(i.virtualPortId) })
      case 'mix':
        return t('wiring.mix', { where: slot(i), n: i.sources, device: nameOf(i.equipmentId) })
      default:
        return ''
    }
  }
  const byDevice = new Map<string, PortUse[]>()
  for (const u of use) if (u.used > 0) byDevice.set(u.equipmentId, [...(byDevice.get(u.equipmentId) ?? []), u])
  const status = errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ok'
  return (
    <div className="mt-3 flex flex-col gap-3">
      <Button onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="flex items-center gap-2">
          <StatusDot status={status} />
          {t('wiring.title', { n: cables.length })}
        </span>
      </Button>
      {open && (
        <div className="flex flex-col gap-4 rounded-container border border-line p-3">
          {errors.length + warnings.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {[...errors, ...warnings].map((i, k) => (
                <li key={k} className={`flex items-start gap-2 text-base ${isWarning(i) ? 'text-warn' : 'text-danger'}`}>
                  <StatusDot status={isWarning(i) ? 'warning' : 'error'} />
                  <span className="min-w-0">{issueText(i)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-base text-ink-muted">{t('wiring.allGood')}</p>
          )}

          {byDevice.size > 0 && (
            <div className="flex flex-col gap-1">
              <h4 className="text-base font-bold">{t('wiring.channels')}</h4>
              {[...byDevice].map(([id, ports]) => (
                <p key={id} className="text-base">
                  <span className="font-semibold">{nameOf(id)}:</span> {ports.map((u) => t('wiring.used', { name: u.name, used: u.used, total: u.total })).join(' · ')}
                </p>
              ))}
            </div>
          )}

          {adapters.length > 0 && (
            <div className="flex flex-col gap-1">
              <h4 className="text-base font-bold">{t('wiring.adapters', { n: adapters.length })}</h4>
              {adapters.map((c) => (
                <p key={c.number} className="text-base">
                  {t('wiring.adapterRow', { number: c.number, from: plug(c.fromConnector), to: plug(c.toConnector) })}
                </p>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <h4 className="text-base font-bold">{t('wiring.cables')}</h4>
            {cables.length === 0 ? (
              <p className="text-base text-ink-muted">{t('wiring.none')}</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {cables.map((c) => (
                  <li key={c.number} className="flex flex-wrap items-baseline gap-x-2 border-b border-line pb-2 text-base last:border-b-0">
                    <span className="w-8 font-bold tabular-nums">{c.number}</span>
                    <span className="min-w-0 flex-1">
                      {nameOf(c.from.equipmentId)} · {refText(c.from)} → {nameOf(c.to.equipmentId)} · {refText(c.to)}
                    </span>
                    <span className="text-ink-muted">
                      {plug(c.fromConnector)} → {plug(c.toConnector)}
                    </span>
                    {c.y && <Badge tone="neutral">{t('wiring.y')}</Badge>}
                    {c.adapter && <Badge tone="warning">{t('map.adapter')}</Badge>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
