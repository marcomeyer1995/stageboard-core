import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BUILTIN_MODELS,
  ConnectorSchema,
  defaultSignalKind,
  numberPorts,
  PORT_SIGNALS,
  portSignalKind,
  type Connector,
  type Port,
  type PortDirection,
  type PortPart,
  type PortSignalKind,
  type Signal,
  type StageEquipment,
} from 'shared-types'
import { AddRow, Button, Dialog, Field, IconButton, Segmented, Select, Stepper } from './ui'

/** Plugs a person picks - real sockets, plus radio, sound into the room and built in (a wedge's "Schall"). */
const PICKABLE = ['xlr', 'xlr-jack', 'jack-6.3', 'jack-6.3-ts', 'jack-3.5', 'rca', 'usb-b', 'usb-a', 'usb-c', 'ethernet', 'din5', 'dmx', 'wireless', 'room', 'builtin'] as const satisfies readonly Connector[]
const MAX_CHANNELS = 128
/** Sockets that are a container of protocols (docs/31 §7b): their parts are listed under them. */
const CONTAINERS = ['usb-a', 'usb-b', 'usb-c', 'ethernet'] as const satisfies readonly Connector[]
/** Sockets that can carry two pins (left and right) - a stereo jack, a headphone socket, radio. */
const STEREO_ABLE = ['jack-6.3', 'jack-3.5', 'rca', 'wireless', 'builtin'] as const satisfies readonly Connector[]
/** What one part of a container carries. */
const PART_KINDS = ['audio', 'midi', 'osc', 'net', 'dmx'] as const
type PartKind = (typeof PART_KINDS)[number]
const PART_SIGNALS: Record<PartKind, Signal[]> = { audio: ['usb-audio'], midi: ['midi'], osc: ['osc'], net: ['net'], dmx: ['dmx'] }
const partKindOf = (part: PortPart): PartKind => (part.signals.some((x) => x === 'usb-audio' || x === 'audio') ? 'audio' : part.signals.includes('midi') ? 'midi' : part.signals.includes('osc') ? 'osc' : part.signals.includes('dmx') ? 'dmx' : 'net')

interface PartRow {
  key: string
  id: string | null
  name: string
  kind: PartKind
  direction: PortDirection
  count: number
}
/** Translation keys can't hold a dot ("jack-6.3"). */
const plugKey = (c: (typeof PICKABLE)[number]) => c.replace('.', '') as 'xlr' | 'xlr-jack' | 'jack-63' | 'jack-63-ts' | 'jack-35' | 'rca' | 'usb-b' | 'usb-a' | 'usb-c' | 'ethernet' | 'din5' | 'dmx' | 'wireless' | 'room' | 'builtin'

interface Row {
  key: string
  /** The port's id - kept for an existing port, so its cables stay. */
  id: string | null
  name: string
  direction: PortDirection
  connector: Connector
  count: number
  signal: PortSignalKind
  /** Pins of one socket: 1 mono, 2 stereo (#739). */
  pins: number
  /** The parts of a container (USB, network): protocol, direction, channels. */
  parts: PartRow[]
}

const rowOf = (p: Port): Row => ({
  key: p.id,
  id: p.id,
  name: p.name,
  direction: p.direction,
  connector: p.connector,
  count: p.channels ?? 1,
  signal: portSignalKind(p),
  pins: p.pins ?? (p.stereo ? 2 : 1),
  parts: (p.parts ?? []).map((part) => ({ key: part.id, id: part.id, name: part.name, kind: partKindOf(part), direction: part.direction, count: part.channels ?? 1 })),
})

function portOf(row: Row, taken: Set<string>): Port {
  let id = row.id
  if (!id) {
    const base = row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'port'
    id = base
    for (let i = 2; taken.has(id); i++) id = `${base}-${i}`
  }
  taken.add(id)
  const parts = CONTAINERS.includes(row.connector as (typeof CONTAINERS)[number]) ? row.parts.filter((x) => x.name.trim() !== '') : []
  const partIds = new Set<string>()
  const built: PortPart[] = parts.map((x) => {
    let partId = x.id
    if (!partId) {
      const base = `${id}/${x.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || x.kind}`
      partId = base
      for (let i = 2; partIds.has(partId); i++) partId = `${base}-${i}`
    }
    partIds.add(partId)
    const part: PortPart = { id: partId, name: x.name.trim(), signals: PART_SIGNALS[x.kind], direction: x.direction }
    return x.count >= 2 ? { ...part, channels: x.count } : part
  })
  // A container carries what its parts carry - that is what a cable to it can share.
  const signals: Signal[] = built.length > 0 ? [...new Set(built.flatMap((x) => x.signals))] : [...PORT_SIGNALS[row.signal]]
  const port: Port = { id, name: row.name.trim(), connector: row.connector, signals, direction: row.direction }
  return {
    ...port,
    ...(row.count >= 2 ? { channels: row.count } : {}),
    ...(row.pins > 1 && STEREO_ABLE.includes(row.connector as (typeof STEREO_ABLE)[number]) ? { pins: row.pins } : {}),
    ...(built.length > 0 ? { parts: built } : {}),
  }
}

/**
 * "Anschlüsse" of a piece of equipment (Marco, 2026-11-07): a free list instead of fixed fields -
 * every group of inputs or outputs its own row with name, direction, plug, count and signal, as the
 * real device has it (the CQ-18T's Aux outs are mono jacks, the Ui24R has 10 combo and 10 XLR
 * inputs). Groups of the same name count on like the desk ("Eingang" 1-10, 11-20). Saved on this
 * equipment; what no longer fits is dropped by the caller after a confirm. One equipment's list is a
 * self-contained profile - saving and sharing profiles comes later (docs/31 §0b).
 */
export function PortListDialog({ item, onSave, onClose }: { item: StageEquipment; onSave: (ports: Port[]) => void; onClose: () => void }) {
  const { t } = useTranslation('hardware')
  const [rows, setRows] = useState<Row[]>(() => item.ports.map(rowOf))
  const [template, setTemplate] = useState('')
  const update = (key: string, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const add = () => setRows((prev) => [...prev, { key: crypto.randomUUID(), id: null, name: '', direction: 'in', connector: 'xlr', count: 1, signal: 'audio', pins: 1, parts: [] }])
  const updatePart = (key: string, partKey: string, patch: Partial<PartRow>) => update(key, { parts: rows.find((r) => r.key === key)!.parts.map((x) => (x.key === partKey ? { ...x, ...patch } : x)) })
  const addPart = (key: string) => update(key, { parts: [...rows.find((r) => r.key === key)!.parts, { key: crypto.randomUUID(), id: null, name: '', kind: 'audio', direction: 'out', count: 1 }] })
  const removePart = (key: string, partKey: string) => update(key, { parts: rows.find((r) => r.key === key)!.parts.filter((x) => x.key !== partKey) })
  const valid = rows.length > 0 && rows.every((r) => r.name.trim() !== '')
  const save = () => {
    const taken = new Set(rows.flatMap((r) => (r.id ? [r.id] : [])))
    onSave(numberPorts(rows.map((r) => portOf(r, taken))))
  }
  const templates = BUILTIN_MODELS.filter((m) => m.kind !== 'stageboard' && m.kind !== 'stage-server' && m.kind !== 'person' && m.kind !== 'hall')
  return (
    <Dialog
      title={t('ports.title', { name: item.name })}
      onClose={onClose}
      closeOnBackdrop={false}
      size="l"
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t('map.cancel')}
          </Button>
          <Button variant="primary" onClick={save} disabled={!valid}>
            {t('map.save')}
          </Button>
        </>
      }
    >
      <p className="text-base text-ink-muted">{t('ports.intro')}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Select
            label={t('ports.template')}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            options={[{ value: '', label: t('ports.templateNone') }, ...templates.map((m) => ({ value: m.id, label: m.name }))]}
          />
        </div>
        <Button
          disabled={!template}
          onClick={() => {
            const model = templates.find((m) => m.id === template)
            if (model) setRows(model.ports.map((p) => ({ ...rowOf(p), key: crypto.randomUUID(), id: item.ports.some((own) => own.id === p.id) ? p.id : null })))
          }}
        >
          {t('ports.useTemplate')}
        </Button>
      </div>
      <ul className="flex flex-col gap-3">
        {rows.map((r, i) => (
          <li key={r.key} className="flex flex-col gap-2 rounded-container border border-line p-3">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field label={t('ports.name')} value={r.name} placeholder={t('ports.namePlaceholder')} onChange={(e) => update(r.key, { name: e.target.value })} />
              </div>
              <IconButton icon="delete" variant="quiet" label={t('ports.remove', { name: r.name || i + 1 })} onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))} />
            </div>
            <Segmented
              label={t('ports.direction')}
              value={r.direction}
              onChange={(direction) => update(r.key, { direction })}
              options={(['in', 'out', 'both'] as const).map((d) => ({ value: d, label: t(`ports.dir.${d}`) }))}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                label={t('ports.connector')}
                value={r.connector}
                onChange={(e) => {
                  const connector = ConnectorSchema.parse(e.target.value)
                  update(r.key, { connector, signal: defaultSignalKind(connector) })
                }}
                options={PICKABLE.map((c) => ({ value: c, label: t(`ports.plug.${plugKey(c)}`) }))}
              />
              <Select
                label={t('ports.signal')}
                value={r.signal}
                onChange={(e) => update(r.key, { signal: e.target.value as PortSignalKind })}
                options={(Object.keys(PORT_SIGNALS) as PortSignalKind[]).map((s) => ({ value: s, label: t(`ports.sig.${s}`) }))}
              />
            </div>
            <Stepper label={t('ports.count')} unit="" value={r.count} min={1} max={MAX_CHANNELS} onChange={(count) => update(r.key, { count })} />
            {STEREO_ABLE.includes(r.connector as (typeof STEREO_ABLE)[number]) && (
              <Segmented
                label={t('ports.pins')}
                value={String(r.pins)}
                onChange={(v) => update(r.key, { pins: Number(v) })}
                options={[
                  { value: '1', label: t('ports.pinsMono') },
                  { value: '2', label: t('ports.pinsStereo') },
                ]}
              />
            )}
            {CONTAINERS.includes(r.connector as (typeof CONTAINERS)[number]) && (
              <div className="flex flex-col gap-2 border-t border-line pt-2">
                <p className="text-base text-ink-muted">{t('ports.partsHint')}</p>
                <ul className="flex flex-col gap-2">
                  {r.parts.map((x, j) => (
                    <li key={x.key} className="flex flex-col gap-2 rounded-container border border-line p-2">
                      <div className="flex items-end gap-2">
                        <div className="min-w-0 flex-1">
                          <Field label={t('ports.partName')} value={x.name} placeholder={t('ports.partPlaceholder')} onChange={(e) => updatePart(r.key, x.key, { name: e.target.value })} />
                        </div>
                        <IconButton icon="delete" variant="quiet" label={t('ports.partRemove', { name: x.name || j + 1 })} onClick={() => removePart(r.key, x.key)} />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Select label={t('ports.protocol')} value={x.kind} onChange={(e) => updatePart(r.key, x.key, { kind: e.target.value as PartKind })} options={PART_KINDS.map((k) => ({ value: k, label: t(`ports.proto.${k}`) }))} />
                        <Segmented
                          label={t('ports.direction')}
                          value={x.direction}
                          onChange={(direction) => updatePart(r.key, x.key, { direction })}
                          options={(['in', 'out', 'both'] as const).map((d) => ({ value: d, label: t(`ports.dir.${d}`) }))}
                        />
                      </div>
                      <Stepper label={t('ports.count')} unit="" value={x.count} min={1} max={MAX_CHANNELS} onChange={(count) => updatePart(r.key, x.key, { count })} />
                    </li>
                  ))}
                </ul>
                <AddRow label={t('ports.partAdd')} onClick={() => addPart(r.key)} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <AddRow label={t('ports.add')} onClick={add} />
    </Dialog>
  )
}
