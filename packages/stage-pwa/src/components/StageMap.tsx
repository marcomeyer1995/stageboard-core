import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BUILTIN_MODELS,
  CAPABILITIES,
  DEFAULT_VIRTUAL_OUTPUTS,
  DRIVER_KINDS,
  equipmentFrom,
  portFit,
  SIGNAL_CLASS,
  stagePaths,
  type Port,
  type PortRef,
  type SignalClass,
  type StageEquipment,
  type StageLink,
  type StageSetup,
} from 'shared-types'
import { getDeviceId } from '../lib/deviceId'
import { stageMapDefaults } from '../lib/stageMapDefaults'
import { useActiveProfileStore } from '../store/useActiveProfileStore'
import { useDevicesStore } from '../store/useDevicesStore'
import { useDialogStore } from '../store/useDialogStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { usePresenceStore } from '../store/usePresenceStore'
import { useProfilesStore } from '../store/useProfilesStore'
import { useStageMapStore } from '../store/useStageMapStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { AddRow, Badge, Button, IconButton, InfoHint, Segmented, Switch, ToggleChip } from './ui'

/** The map's own coordinates - positions are stored in these. */
const W = 1000
const H = 640
const NODE_W = 170
const NODE_H = 64

const CLASS_STROKE: Record<SignalClass, string> = { sound: 'stroke-accent', midi: 'stroke-accent-2', light: 'stroke-warn' }

/** Capabilities that are the built-in virtual outputs (DEFAULT_VIRTUAL_OUTPUTS) - their old
 * Logical Devices are not offered twice. */
const BUILT_IN_CAPABILITIES: readonly string[] = [CAPABILITIES.clickTrack, CAPABILITIES.audioPlayback, CAPABILITIES.sectionAnnouncements]

type Selection = { kind: 'node'; id: string } | { kind: 'link'; id: string } | null
interface ViewBox {
  x: number
  y: number
  w: number
  h: number
}

function autoPosition(index: number): { x: number; y: number } {
  return { x: 140 + (index % 4) * 260, y: 100 + Math.floor(index / 4) * 160 }
}

function fitView(points: { x: number; y: number }[]): ViewBox {
  if (points.length === 0) return { x: 0, y: 0, w: W, h: H }
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const pad = 40
  const x = Math.min(...xs) - NODE_W / 2 - pad
  const y = Math.min(...ys) - NODE_H / 2 - pad
  return { x, y, w: Math.max(...xs) + NODE_W / 2 + pad - x, h: Math.max(...ys) + NODE_H / 2 + pad - y }
}

const portOf = (equipment: StageEquipment | undefined, portId: string): Port | undefined => equipment?.ports.find((p) => p.id === portId)

/**
 * The stage map (docs/31 §7): the band's equipment, the cables between their ports, and what is
 * patched onto them - per setup. Pan and zoom with a finger or the mouse, fullscreen on the phone.
 * Editing: everyone wires their own device, the admin everything else. Nothing decides who plays
 * what from this yet (docs/31 §6, step 2).
 */
export function StageMap() {
  const { t } = useTranslation('hardware')
  const { equipment, setups, loaded, saveEquipment, removeEquipment, saveSetup, updateSetup, removeSetup } = useStageMapStore()
  const devices = useDevicesStore((state) => state.devices)
  const devicesLoaded = useDevicesStore((state) => state.loaded)
  const logicalDevices = useLogicalDevicesStore((state) => state.devices)
  const presence = usePresenceStore((state) => state.presence)
  const people = useProfilesStore((state) => state.profiles)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const isAdmin = useWorkspaceStore((state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.isAdmin ?? false)
  const myProfileId = useActiveProfileStore((state) => state.byWorkspace[workspaceId] ?? '')
  const promptFields = useDialogStore((state) => state.promptFields)
  const confirm = useDialogStore((state) => state.confirm)
  const ownId = getDeviceId()

  const [setupId, setSetupId] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [editing, setEditing] = useState(false)
  const [showPorts, setShowPorts] = useState(false)
  const [connectFrom, setConnectFrom] = useState<PortRef | null>(null)
  const [full, setFull] = useState(false)
  const [view, setView] = useState<ViewBox | null>(null)
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null)

  // The default map (decision 6): a band without one gets it, a new device joins it.
  const writing = useRef(false)
  useEffect(() => {
    if (!loaded || !devicesLoaded || writing.current) return
    const writes = stageMapDefaults({ equipment, setups }, devices, ownId)
    if (writes.equipment.length + writes.newSetups.length + writes.addTo.length === 0) return
    writing.current = true
    void (async () => {
      for (const e of writes.equipment) await saveEquipment(e)
      for (const s of writes.newSetups) await saveSetup(s)
      for (const a of writes.addTo) await updateSetup(a.setupId, a.apply)
    })()
      .catch((err: unknown) => console.warn('[StageMap] default map not written', err))
      .finally(() => {
        writing.current = false
      })
  }, [loaded, devicesLoaded, equipment, setups, devices, ownId, saveEquipment, saveSetup, updateSetup])

  const setup: StageSetup | undefined = setups.find((s) => s.id === setupId) ?? setups[0]
  const byId = useMemo(() => new Map(equipment.map((e) => [e.id, e])), [equipment])
  const onStage = useMemo(() => (setup ? equipment.filter((e) => setup.positions[e.id]) : []), [equipment, setup])
  const offStage = useMemo(() => (setup ? equipment.filter((e) => !setup.positions[e.id]) : []), [equipment, setup])
  const positionOf = (id: string) => (dragPos?.id === id ? dragPos : (setup?.positions[id] ?? autoPosition(0)))
  const paths = useMemo(() => (setup ? stagePaths({ equipment, setups }, setup.id) : []), [equipment, setups, setup])

  // The first view: the whole stage; again when the setup changes.
  const fittedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!setup || fittedFor.current === setup.id || onStage.length === 0) return
    fittedFor.current = setup.id
    setView(fitView(onStage.map((e) => setup.positions[e.id]!)))
  }, [setup, onStage])
  const viewBox = view ?? { x: 0, y: 0, w: W, h: H }
  const showWhole = () => setup && setView(fitView(onStage.map((e) => setup.positions[e.id]!)))

  const personName = (profileId: string | undefined) => people.find((p) => p.id === profileId)?.name ?? null
  const subtitle = (e: StageEquipment): string => {
    if (e.kind === 'stageboard' && e.deviceId) return personName(presence.devices[e.deviceId]?.profileId) ?? t('map.nobody')
    if (e.listener?.kind === 'signed-in') return t('map.atDevice', { device: byId.get(`device:${e.listener.deviceId}`)?.name ?? '' })
    if (e.listener?.kind === 'profile') return personName(e.listener.profileId) ?? e.name
    return BUILTIN_MODELS.find((m) => m.id === e.modelId)?.name ?? ''
  }
  const listenerName = (id: string) => {
    const e = byId.get(id)
    return e ? title(e) : id
  }
  const title = (e: StageEquipment) => (e.listener?.kind === 'signed-in' ? (personName(presence.devices[e.listener.deviceId]?.profileId) ?? t('map.nobodyShort')) : e.name)

  const virtualOutputs = useMemo(
    () => [
      ...DEFAULT_VIRTUAL_OUTPUTS.map((v) => ({ id: v.id, name: v.name })),
      ...logicalDevices.filter((d) => !BUILT_IN_CAPABILITIES.includes(d.capability)).map((d) => ({ id: d.id, name: d.name })),
    ],
    [logicalDevices],
  )
  const virtualName = (id: string) => virtualOutputs.find((v) => v.id === id)?.name ?? id

  // Who may change what: the admin everything, everyone else the cables of their own device.
  const signedIn = myProfileId !== ''
  const ownsDevice = (e: StageEquipment | undefined) => !!e?.deviceId && (e.deviceId === ownId || presence.devices[e.deviceId]?.profileId === myProfileId)
  const canWire = (e: StageEquipment | undefined) => editing && signedIn && (isAdmin || ownsDevice(e))
  const canMove = (e: StageEquipment) => editing && signedIn && (isAdmin || ownsDevice(e))
  const canWireLink = (l: StageLink) => canWire(byId.get(l.from.equipmentId)) || canWire(byId.get(l.to.equipmentId))
  const canGear = editing && isAdmin

  const portLabel = (ref: PortRef) => {
    const port = portOf(byId.get(ref.equipmentId), ref.portId)
    const item = byId.get(ref.equipmentId)
    return `${item ? title(item) : '?'} · ${port?.name ?? ref.portId}${ref.channel === undefined ? '' : ` ${ref.channel}`}`
  }

  // Connect: candidate targets are equipment with a port that fits.
  const connectPort = connectFrom ? portOf(byId.get(connectFrom.equipmentId), connectFrom.portId) : undefined
  const fitsFrom = (target: StageEquipment) => {
    if (!connectPort || !connectFrom || target.id === connectFrom.equipmentId) return [] as { port: Port; reverse: boolean }[]
    const out: { port: Port; reverse: boolean }[] = []
    for (const port of target.ports) {
      if (portFit(connectPort, port)) out.push({ port, reverse: false })
      else if (portFit(port, connectPort)) out.push({ port, reverse: true })
    }
    return out
  }

  const finishConnect = async (target: StageEquipment) => {
    if (!connectFrom || !connectPort || !setup) return
    const fits = fitsFrom(target)
    if (fits.length === 0) return
    const options = fits.flatMap(({ port, reverse }) =>
      port.channels
        ? Array.from({ length: port.channels }, (_, i) => ({ value: `${port.id}#${i + 1}#${reverse ? 1 : 0}`, label: `${port.name} ${i + 1}` }))
        : [{ value: `${port.id}##${reverse ? 1 : 0}`, label: port.name }],
    )
    let picked = options.length === 1 ? options[0]!.value : null
    if (!picked) {
      const answer = await promptFields(t('map.pickPort', { name: target.name }), [{ key: 'port', label: t('map.port'), type: 'radio', options, defaultValue: options[0]!.value }], t('map.connect'))
      picked = answer?.port ?? null
    }
    if (!picked) return
    const [portId, channel, reverse] = picked.split('#')
    const there: PortRef = channel ? { equipmentId: target.id, portId: portId!, channel: Number(channel) } : { equipmentId: target.id, portId: portId! }
    const [from, to] = reverse === '1' ? [there, connectFrom] : [connectFrom, there]
    const fit = portFit(portOf(byId.get(from.equipmentId), from.portId)!, portOf(byId.get(to.equipmentId), to.portId)!)
    if (!fit) return
    const link: StageLink = { id: crypto.randomUUID(), from, to, signals: fit.signals }
    await updateSetup(setup.id, (s) => ({ ...s, links: [...s.links, link] }))
    setConnectFrom(null)
    setSelection({ kind: 'link', id: link.id })
  }

  // Pan, pinch and drag - pointer events in map coordinates.
  const svgRef = useRef<SVGSVGElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ kind: 'pan' | 'node' | 'pinch'; id?: string; startView: ViewBox; start: { x: number; y: number }; dist?: number; moved: boolean } | null>(null)
  const unitsPerPx = () => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 1
    return Math.max(viewBox.w / rect.width, viewBox.h / rect.height)
  }
  const onPointerDown = (event: ReactPointerEvent, nodeId?: string) => {
    event.stopPropagation()
    ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = { kind: 'pinch', startView: viewBox, start: { x: 0, y: 0 }, dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), moved: true }
      return
    }
    const node = nodeId ? byId.get(nodeId) : undefined
    gesture.current = { kind: node && canMove(node) ? 'node' : 'pan', id: nodeId, startView: viewBox, start: { x: event.clientX, y: event.clientY }, moved: false }
  }
  const onPointerMove = (event: ReactPointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pinch' && pointers.current.size === 2 && g.dist) {
      const [a, b] = [...pointers.current.values()]
      const factor = g.dist / Math.max(1, Math.hypot(a!.x - b!.x, a!.y - b!.y))
      zoomTo(g.startView, factor)
      return
    }
    const dx = event.clientX - g.start.x
    const dy = event.clientY - g.start.y
    if (!g.moved && Math.hypot(dx, dy) < 6) return
    g.moved = true
    const k = unitsPerPx()
    if (g.kind === 'pan') setView({ ...g.startView, x: g.startView.x - dx * k, y: g.startView.y - dy * k })
    else if (g.kind === 'node' && g.id && setup) {
      const start = setup.positions[g.id] ?? autoPosition(0)
      setDragPos({ id: g.id, x: Math.round(start.x + dx * k), y: Math.round(start.y + dy * k) })
    }
  }
  const onPointerUp = (event: ReactPointerEvent, nodeId?: string) => {
    event.stopPropagation()
    pointers.current.delete(event.pointerId)
    const g = gesture.current
    if (pointers.current.size > 0) return
    gesture.current = null
    if (g?.kind === 'node' && g.moved && dragPos && setup) {
      const { id, x, y } = dragPos
      void updateSetup(setup.id, (s) => ({ ...s, positions: { ...s.positions, [id]: { x, y } } })).finally(() => setDragPos(null))
      return
    }
    if (g?.moved) return
    // A tap.
    if (!nodeId) {
      if (!connectFrom) setSelection(null)
      return
    }
    const node = byId.get(nodeId)
    if (connectFrom && node) void finishConnect(node)
    else setSelection({ kind: 'node', id: nodeId })
  }
  const zoomTo = (from: ViewBox, factor: number) => {
    const w = Math.min(Math.max(from.w * factor, 200), 4000)
    const h = (from.h / from.w) * w
    setView({ x: from.x + (from.w - w) / 2, y: from.y + (from.h - h) / 2, w, h })
  }
  const onWheel = (event: React.WheelEvent) => zoomTo(viewBox, event.deltaY > 0 ? 1.15 : 1 / 1.15)

  const toggleFull = (next: boolean) => {
    setFull(next)
    // The browser's own fullscreen where it has one; the overlay alone is enough on the phone.
    if (next) void document.documentElement.requestFullscreen?.().catch(() => undefined)
    else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
  }
  useEffect(() => {
    if (!full) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && toggleFull(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full])

  // Admin actions.
  const addEquipment = async () => {
    if (!setup) return
    const models = BUILTIN_MODELS.filter((m) => m.kind !== 'stageboard')
    const answer = await promptFields(
      t('map.addTitle'),
      [
        { key: 'model', label: t('map.model'), type: 'radio', options: models.map((m) => ({ value: m.id, label: m.name })), defaultValue: models[0]!.id },
        { key: 'name', label: t('map.name') },
      ],
      t('map.add'),
    )
    const model = models.find((m) => m.id === answer?.model)
    if (!answer || !model) return
    const item = equipmentFrom(model, crypto.randomUUID(), answer.name?.trim() || model.name)
    await saveEquipment(item)
    const at = { x: Math.round(viewBox.x + viewBox.w / 2), y: Math.round(viewBox.y + viewBox.h / 2) }
    await updateSetup(setup.id, (s) => ({ ...s, positions: { ...s.positions, [item.id]: at } }))
    setSelection({ kind: 'node', id: item.id })
  }
  const placeOnStage = (item: StageEquipment) => {
    if (!setup) return
    const at = { x: Math.round(viewBox.x + viewBox.w / 2), y: Math.round(viewBox.y + viewBox.h / 2) }
    void updateSetup(setup.id, (s) => ({ ...s, positions: { ...s.positions, [item.id]: at } }))
  }
  const renameEquipment = async (item: StageEquipment) => {
    const answer = await promptFields(t('map.rename'), [{ key: 'name', label: t('map.name'), defaultValue: item.name }], t('map.save'))
    const name = answer?.name?.trim()
    if (name) await saveEquipment({ ...item, name })
  }
  const takeOffStage = async (item: StageEquipment) => {
    if (!setup) return
    await takeOffStageIn(setup.id, item.id)
    setSelection(null)
  }
  const deleteEquipment = async (item: StageEquipment) => {
    if (!(await confirm(t('map.deleteConfirm', { name: item.name }), { danger: true, confirmLabel: t('map.delete') }))) return
    for (const s of setups) if (s.positions[item.id] || s.links.some((l) => l.from.equipmentId === item.id || l.to.equipmentId === item.id)) await takeOffStageIn(s.id, item.id)
    await removeEquipment(item.id)
    setSelection(null)
  }
  const takeOffStageIn = (id: string, itemId: string) =>
    updateSetup(id, (s) => {
      const positions = { ...s.positions }
      delete positions[itemId]
      const gone = s.links.filter((l) => l.from.equipmentId === itemId || l.to.equipmentId === itemId).map((l) => l.id)
      return { ...s, positions, links: s.links.filter((l) => !gone.includes(l.id)), patch: s.patch.filter((p) => !gone.includes(p.linkId)) }
    })
  const addSetup = async () => {
    if (!setup) return
    const answer = await promptFields(t('map.newSetup'), [{ key: 'name', label: t('map.name') }], t('map.add'))
    const name = answer?.name?.trim()
    if (!name) return
    const copy: StageSetup = { ...setup, id: crypto.randomUUID(), name }
    await saveSetup(copy)
    setSetupId(copy.id)
  }
  const deleteSetup = async () => {
    if (!setup || setups.length < 2) return
    if (!(await confirm(t('map.deleteSetupConfirm', { name: setup.name }), { danger: true, confirmLabel: t('map.delete') }))) return
    await removeSetup(setup.id)
    setSetupId(null)
  }

  const removeLink = (link: StageLink) =>
    setup && void updateSetup(setup.id, (s) => ({ ...s, links: s.links.filter((l) => l.id !== link.id), patch: s.patch.filter((p) => p.linkId !== link.id) })).then(() => setSelection(null))
  const togglePatch = (link: StageLink, virtualPortId: string, on: boolean) =>
    setup &&
    void updateSetup(setup.id, (s) => ({
      ...s,
      patch: on ? [...s.patch.filter((p) => !(p.linkId === link.id && p.virtualPortId === virtualPortId)), { virtualPortId, linkId: link.id }] : s.patch.filter((p) => !(p.linkId === link.id && p.virtualPortId === virtualPortId)),
    }))
  const toggleRoute = (link: StageLink, route: { portId: string; channel?: number }, on: boolean) =>
    setup &&
    void updateSetup(setup.id, (s) => ({
      ...s,
      links: s.links.map((l) => {
        if (l.id !== link.id) return l
        const same = (r: { portId: string; channel?: number }) => r.portId === route.portId && r.channel === route.channel
        const routes = (l.routes ?? []).filter((r) => !same(r))
        return { ...l, routes: on ? [...routes, route] : routes }
      }),
    }))

  if (!loaded || !setup) return <p className="mb-6 text-base text-ink-muted">{t('map.loading')}</p>

  const selectedNode = selection?.kind === 'node' ? byId.get(selection.id) : undefined
  const selectedLink = selection?.kind === 'link' ? setup.links.find((l) => l.id === selection.id) : undefined
  const highlighted = new Set<string>()
  if (selectedLink) for (const p of paths) if (p.linkIds.includes(selectedLink.id)) p.linkIds.forEach((id) => highlighted.add(id))
  if (selectedNode) for (const l of setup.links) if (l.from.equipmentId === selectedNode.id || l.to.equipmentId === selectedNode.id) highlighted.add(l.id)
  const linkLabel = (l: StageLink) => setup.patch.filter((p) => p.linkId === l.id).map((p) => virtualName(p.virtualPortId))

  return (
    <section className={full ? 'fixed inset-0 z-takeover flex flex-col bg-stage p-2' : 'mb-6'}>
      {!full && (
        <div className="mb-2 flex items-center gap-1">
          <h2 className="text-xl font-bold">{t('map.title')}</h2>
          <InfoHint label={t('map.explainLabel')} text={t('map.explain')} />
        </div>
      )}
      {setups.length > 1 && (
        <div className="mb-2">
          <Segmented label={t('map.setup')} value={setup.id} onChange={(id) => { setSetupId(id); setSelection(null) }} options={setups.map((s) => ({ value: s.id, label: s.name }))} />
        </div>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button onClick={showWhole}>{t('map.whole')}</Button>
        <Switch layout="inline" label={t('map.ports')} checked={showPorts} onChange={setShowPorts} />
        {signedIn && <Switch layout="inline" label={t('map.edit')} checked={editing} onChange={(on) => { setEditing(on); setConnectFrom(null) }} />}
        <span className="flex-1" />
        <IconButton icon={full ? 'exitFullscreen' : 'fullscreen'} label={full ? t('map.exitFull') : t('map.full')} onClick={() => toggleFull(!full)} />
      </div>
      {!signedIn && <p className="mb-2 text-base text-ink-muted">{t('stage.viewOnly')}</p>}
      {connectFrom && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-container border border-accent p-2">
          <span className="min-w-0 flex-1 text-base">{t('map.connecting', { port: portLabel(connectFrom) })}</span>
          <Button variant="quiet" onClick={() => setConnectFrom(null)}>
            {t('map.cancel')}
          </Button>
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className={`w-full touch-none select-none rounded-container border border-line bg-surface ${full ? 'min-h-0 flex-1' : 'h-[60vh] max-h-[560px]'}`}
        onPointerDown={(e) => onPointerDown(e)}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => onPointerUp(e)}
        onPointerCancel={(e) => onPointerUp(e)}
        onWheel={onWheel}
        role="img"
        aria-label={t('map.title')}
      >
        {setup.links.map((l) => {
          const a = positionOf(l.from.equipmentId)
          const b = positionOf(l.to.equipmentId)
          const cls = SIGNAL_CLASS[l.signals[0]!]
          const on = highlighted.size === 0 || highlighted.has(l.id)
          const labels = linkLabel(l)
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
          const portText = showPorts || highlighted.has(l.id)
          return (
            <g key={l.id} className={on ? '' : 'opacity-25'}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={CLASS_STROKE[cls]} strokeWidth={selectedLink?.id === l.id ? 6 : 3} />
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="transparent"
                strokeWidth={28}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => {
                  e.stopPropagation()
                  if (!connectFrom) setSelection({ kind: 'link', id: l.id })
                }}
              />
              {labels.length > 0 && (
                <text x={mid.x} y={mid.y - 8} textAnchor="middle" className="fill-ink text-[16px] font-semibold" style={{ paintOrder: 'stroke' }} stroke="rgb(var(--sb-surface))" strokeWidth={5}>
                  {labels.join(' · ')}
                </text>
              )}
              {portText && (
                <text x={mid.x} y={mid.y + 16} textAnchor="middle" className="fill-ink-muted text-[15px]" style={{ paintOrder: 'stroke' }} stroke="rgb(var(--sb-surface))" strokeWidth={5}>
                  {`${portOf(byId.get(l.from.equipmentId), l.from.portId)?.name ?? ''} → ${portOf(byId.get(l.to.equipmentId), l.to.portId)?.name ?? ''}${l.to.channel ? ` ${l.to.channel}` : ''}`}
                </text>
              )}
            </g>
          )
        })}
        {onStage.map((e) => {
          const p = positionOf(e.id)
          const selected = selectedNode?.id === e.id
          const candidate = connectFrom ? fitsFrom(e).length > 0 : false
          const dim = connectFrom ? !candidate && e.id !== connectFrom.equipmentId : false
          const own = e.deviceId === ownId
          return (
            <g
              key={e.id}
              transform={`translate(${p.x - NODE_W / 2} ${p.y - NODE_H / 2})`}
              className={`cursor-pointer ${dim ? 'opacity-30' : ''}`}
              onPointerDown={(ev) => onPointerDown(ev, e.id)}
              onPointerMove={onPointerMove}
              onPointerUp={(ev) => onPointerUp(ev, e.id)}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={12}
                className={`${DRIVER_KINDS.includes(e.kind) ? 'fill-control-strong' : 'fill-control'} ${selected || candidate ? 'stroke-accent' : own ? 'stroke-accent-2' : 'stroke-ink-faint'}`}
                strokeWidth={selected || candidate ? 4 : 2}
              />
              <text x={NODE_W / 2} y={26} textAnchor="middle" className="fill-ink text-[19px] font-bold">
                {title(e).length > 16 ? `${title(e).slice(0, 15)}…` : title(e)}
              </text>
              <text x={NODE_W / 2} y={50} textAnchor="middle" className="fill-ink-muted text-[16px]">
                {subtitle(e).slice(0, 20)}
              </text>
            </g>
          )
        })}
      </svg>

      <div className={`mt-2 flex flex-col gap-3 ${full ? 'max-h-[40%] overflow-y-auto' : ''}`}>
        {selectedNode && (
          <div className="flex flex-col gap-2 rounded-container border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-bold">{title(selectedNode)}</span>
              <span className="text-base text-ink-muted">{subtitle(selectedNode)}</span>
              {selectedNode.deviceId === ownId && <Badge tone="accent">{t('stage.thisDevice')}</Badge>}
            </div>
            <ul className="flex flex-col gap-2">
              {selectedNode.ports.map((port) => {
                const cables = setup.links.filter((l) => (l.from.equipmentId === selectedNode.id && l.from.portId === port.id) || (l.to.equipmentId === selectedNode.id && l.to.portId === port.id))
                return (
                  <li key={port.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="min-w-0 flex-1 text-base">
                      <span className="font-semibold">{port.name}</span>
                      <span className="text-ink-muted"> · {t(`map.dir.${port.direction}`)} · {port.signals.map((s) => t(`map.signal.${s}`)).join(', ')}</span>
                      {cables.map((l) => (
                        <button key={l.id} type="button" className="block text-left text-ink-soft underline" onClick={() => setSelection({ kind: 'link', id: l.id })}>
                          {l.from.equipmentId === selectedNode.id ? `→ ${portLabel(l.to)}` : `← ${portLabel(l.from)}`}
                        </button>
                      ))}
                    </span>
                    {canWire(selectedNode) && !connectFrom && (
                      <Button onClick={() => setConnectFrom({ equipmentId: selectedNode.id, portId: port.id })}>{t('map.connect')}</Button>
                    )}
                  </li>
                )
              })}
            </ul>
            {canGear && (
              <div className="flex flex-wrap gap-2">
                <Button icon="rename" onClick={() => void renameEquipment(selectedNode)}>
                  {t('map.rename')}
                </Button>
                <Button onClick={() => void takeOffStage(selectedNode)}>{t('map.offStage')}</Button>
                {selectedNode.kind !== 'stageboard' && (
                  <Button variant="danger" icon="delete" onClick={() => void deleteEquipment(selectedNode)}>
                    {t('map.delete')}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {selectedLink && (
          <LinkPanel
            link={selectedLink}
            from={portLabel(selectedLink.from)}
            to={portLabel(selectedLink.to)}
            adapter={(() => {
              const a = portOf(byId.get(selectedLink.from.equipmentId), selectedLink.from.portId)
              const b = portOf(byId.get(selectedLink.to.equipmentId), selectedLink.to.portId)
              return a && b ? (portFit(a, b)?.adapter ?? false) : false
            })()}
            paths={paths.filter((p) => p.linkIds.includes(selectedLink.id)).map((p) => ({ key: p.key, cls: p.signalClass, listeners: p.listenerIds.map(listenerName) }))}
            patchable={DRIVER_KINDS.includes(byId.get(selectedLink.from.equipmentId)?.kind ?? 'person')}
            virtualOutputs={virtualOutputs}
            patched={setup.patch.filter((p) => p.linkId === selectedLink.id).map((p) => p.virtualPortId)}
            mixerOutputs={byId.get(selectedLink.to.equipmentId)?.kind === 'mixer' ? byId.get(selectedLink.to.equipmentId)!.ports.filter((p) => p.direction !== 'in') : null}
            editable={canWireLink(selectedLink)}
            onPatch={(id, on) => togglePatch(selectedLink, id, on)}
            onRoute={(route, on) => toggleRoute(selectedLink, route, on)}
            onRemove={() => removeLink(selectedLink)}
          />
        )}

        {!selectedNode && !selectedLink && !connectFrom && <p className="text-base text-ink-muted">{t('map.hint')}</p>}
        {canGear && !selectedNode && !selectedLink && (
          <div className="flex flex-col gap-2">
            <AddRow label={t('map.addEquipment')} onClick={() => void addEquipment()} />
            <div className="flex flex-wrap gap-2">
              <AddRow inline label={t('map.newSetup')} onClick={() => void addSetup()} />
              {setups.length > 1 && (
                <Button variant="danger" icon="delete" onClick={() => void deleteSetup()}>
                  {t('map.deleteSetup')}
                </Button>
              )}
            </div>
            {offStage.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base text-ink-muted">{t('map.offStageList')}</span>
                {offStage.map((e) => (
                  <AddRow key={e.id} inline label={e.name} onClick={() => placeOnStage(e)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function LinkPanel(props: {
  link: StageLink
  from: string
  to: string
  adapter: boolean
  paths: { key: string; cls: SignalClass; listeners: string[] }[]
  patchable: boolean
  virtualOutputs: { id: string; name: string }[]
  patched: string[]
  mixerOutputs: Port[] | null
  editable: boolean
  onPatch: (virtualPortId: string, on: boolean) => void
  onRoute: (route: { portId: string; channel?: number }, on: boolean) => void
  onRemove: () => void
}) {
  const { t } = useTranslation('hardware')
  const { link } = props
  const routed = (portId: string, channel?: number) => (link.routes ?? []).some((r) => r.portId === portId && r.channel === channel)
  return (
    <div className="flex flex-col gap-3 rounded-container border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 text-lg font-bold">
          {props.from} → {props.to}
        </span>
        {props.adapter && <Badge tone="warning">{t('map.adapter')}</Badge>}
      </div>
      <ul className="flex flex-col gap-1">
        {props.paths.map((p) => (
          <li key={p.key} className="text-base">
            <span className="font-semibold">{t(`map.class.${p.cls}`)}</span>
            <span className="text-ink-muted"> → {p.listeners.length > 0 ? p.listeners.join(', ') : t('map.nowhere')}</span>
          </li>
        ))}
      </ul>
      {props.patchable && (
        <div className="flex flex-col gap-1">
          <span className="text-base font-semibold">{t('map.patched')}</span>
          <div className="flex flex-wrap gap-2">
            {props.virtualOutputs.map((v) => (
              <ToggleChip key={v.id} label={v.name} selected={props.patched.includes(v.id)} disabled={!props.editable} onToggle={(on) => props.onPatch(v.id, on)} />
            ))}
          </div>
        </div>
      )}
      {props.mixerOutputs && (
        <div className="flex flex-col gap-1">
          <span className="text-base font-semibold">{t('map.routes')}</span>
          {!link.routes?.length && <span className="text-base text-ink-muted">{t('map.noRoutes')}</span>}
          <div className="flex flex-wrap gap-2">
            {props.mixerOutputs.flatMap((port) =>
              port.channels
                ? Array.from({ length: port.channels }, (_, i) => (
                    <ToggleChip
                      key={`${port.id}${i + 1}`}
                      label={`${port.name} ${i + 1}`}
                      selected={routed(port.id, i + 1)}
                      disabled={!props.editable}
                      onToggle={(on) => props.onRoute({ portId: port.id, channel: i + 1 }, on)}
                    />
                  ))
                : [<ToggleChip key={port.id} label={port.name} selected={routed(port.id)} disabled={!props.editable} onToggle={(on) => props.onRoute({ portId: port.id }, on)} />],
            )}
          </div>
        </div>
      )}
      {props.editable && (
        <div>
          <Button variant="danger" icon="delete" onClick={props.onRemove}>
            {t('map.removeLink')}
          </Button>
        </div>
      )}
    </div>
  )
}
