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
  type PortSignalKind,
  type StageEquipment,
} from 'shared-types'
import { AddRow, Button, Dialog, Field, IconButton, Segmented, Select, Stepper } from './ui'

/** Plugs a person picks - real sockets, plus radio, sound into the room and built in (a wedge's "Schall"). */
const PICKABLE = ['xlr', 'xlr-jack', 'jack-6.3', 'jack-6.3-ts', 'jack-3.5', 'rca', 'usb-b', 'usb-a', 'usb-c', 'ethernet', 'din5', 'dmx', 'wireless', 'room', 'builtin'] as const satisfies readonly Connector[]
const MAX_CHANNELS = 128
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
}

const rowOf = (p: Port): Row => ({ key: p.id, id: p.id, name: p.name, direction: p.direction, connector: p.connector, count: p.channels ?? 1, signal: portSignalKind(p) })

function portOf(row: Row, taken: Set<string>): Port {
  let id = row.id
  if (!id) {
    const base = row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'port'
    id = base
    for (let i = 2; taken.has(id); i++) id = `${base}-${i}`
  }
  taken.add(id)
  const port: Port = { id, name: row.name.trim(), connector: row.connector, signals: [...PORT_SIGNALS[row.signal]], direction: row.direction }
  return row.count >= 2 ? { ...port, channels: row.count } : port
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
  const add = () => setRows((prev) => [...prev, { key: crypto.randomUUID(), id: null, name: '', direction: 'in', connector: 'xlr', count: 1, signal: 'audio' }])
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
          </li>
        ))}
      </ul>
      <AddRow label={t('ports.add')} onClick={add} />
    </Dialog>
  )
}
