import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BUILTIN_MODELS,
  CAPABILITIES,
  DEFAULT_VIRTUAL_OUTPUTS,
  DRIVER_KINDS,
  effectiveRouting,
  equipmentFrom,
  linkPlaceholder,
  mergeEquipmentInSetup,
  mixerPorts,
  portFit,
  pruneForPorts,
  SIGNAL_CLASS,
  signalFlows,
  virtualPortClass,
  virtualPortIsInput,
  type MatrixPoint,
  type MixerSetup,
  type Port,
  type PortRef,
  type SignalClass,
  type SignalFlow,
  type VirtualPort,
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
import { samePoint } from '../lib/matrixPoint'
import { RoutingMatrix, type MatrixLine } from './RoutingMatrix'
import { MixerSetupDialog } from './MixerSetupDialog'
import { AddRow, Badge, Button, IconButton, InfoHint, Segmented, Switch } from './ui'

/** The map's own coordinates - positions are stored in these. */
const W = 1000
const H = 640
const NODE_W = 170
const NODE_H = 64

const CLASS_STROKE: Record<SignalClass, string> = { sound: 'stroke-accent', midi: 'stroke-accent-2', light: 'stroke-warn' }

/** Capabilities that are the built-in virtual outputs (DEFAULT_VIRTUAL_OUTPUTS) - their old
 * Logical Devices are not offered twice. */
const BUILT_IN_CAPABILITIES: readonly string[] = [CAPABILITIES.clickTrack, CAPABILITIES.audioPlayback, CAPABILITIES.sectionAnnouncements]

/** What a tap shows (Marco, 2026-11-06): a device its interfaces and matrix; a cable first its two
 * ends, tapped again (`chain`) the full way of every signal on it; a signal its full way. */
type Selection = { kind: 'node'; id: string } | { kind: 'link'; id: string; chain: boolean } | { kind: 'signal'; key: string; linkId: string } | null
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
 * The stage map (docs/31 §7): the band's equipment, the cables between their ports, and per setup
 * every device's routing matrix - which signal runs where follows from them. Pan and zoom with a finger or the mouse, fullscreen on the phone.
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
  const [mixerFor, setMixerFor] = useState<StageEquipment | null>(null)
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
    if (e.kind === 'stageboard') return t('map.placeholder')
    // By the device, not by id: a linked placeholder keeps its own id (2026-11-07).
    if (e.listener?.kind === 'signed-in') {
      const at = e.listener.deviceId
      return t('map.atDevice', { device: equipment.find((x) => x.kind === 'stageboard' && x.deviceId === at)?.name ?? '' })
    }
    if (e.listener?.kind === 'profile') return personName(e.listener.profileId) ?? e.name
    return BUILTIN_MODELS.find((m) => m.id === e.modelId)?.name ?? ''
  }
  const listenerName = (id: string) => {
    const e = byId.get(id)
    return e ? title(e) : id
  }
  const title = (e: StageEquipment) => (e.listener?.kind === 'signed-in' ? (personName(presence.devices[e.listener.deviceId]?.profileId) ?? t('map.nobodyShort')) : e.name)

  // The band's virtual ports: Klick, Track, Ansagen and every other Logical Device.
  const virtualPorts: VirtualPort[] = useMemo(
    () => [
      ...DEFAULT_VIRTUAL_OUTPUTS.map((v) => ({ id: v.id, name: v.name, signalClass: virtualPortClass(v.capability), input: false })),
      ...logicalDevices
        .filter((d) => !BUILT_IN_CAPABILITIES.includes(d.capability))
        .map((d) => ({ id: d.id, name: d.name, signalClass: virtualPortClass(d.capability), input: virtualPortIsInput(d.capability) })),
    ],
    [logicalDevices],
  )
  const flows = useMemo(() => (setup ? signalFlows({ equipment, setups }, setup.id, virtualPorts) : []), [equipment, setups, setup, virtualPorts])
  const flowsOn = (linkId: string) => flows.filter((f) => f.hops.some((h) => h.linkId === linkId))

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
    setSelection({ kind: 'link', id: link.id, chain: false })
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
    // A tablet here is a placeholder: planned before it is registered, linked to it later (2026-11-07).
    const models = BUILTIN_MODELS.filter((m) => m.kind !== 'stage-server')
    const answer = await promptFields(
      t('map.addTitle'),
      [
        { key: 'model', label: t('map.model'), type: 'radio', options: models.map((m) => ({ value: m.id, label: m.kind === 'stageboard' ? t('map.placeholderModel') : m.name })), defaultValue: models.find((m) => m.kind === 'mixer')!.id },
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
  // Mischpult einrichten (2026-11-07): new ports on this mixer; cables and matrix points that no
  // longer fit go - in every setup, after a confirm.
  const setUpMixer = async (mixer: StageEquipment, s: MixerSetup) => {
    const ports = mixerPorts(s)
    const pruned = setups.map((x) => pruneForPorts(x, mixer.id, ports))
    const links = pruned.reduce((n, p) => n + p.links, 0)
    const points = pruned.reduce((n, p) => n + p.crosspoints, 0)
    if (links + points > 0 && !(await confirm(t('mixer.pruneConfirm', { links, points }), { danger: true, confirmLabel: t('mixer.pruneOk') }))) return
    setMixerFor(null)
    await saveEquipment({ ...mixer, ports })
    for (const [i, x] of setups.entries()) if (pruned[i]!.links + pruned[i]!.crosspoints > 0) await updateSetup(x.id, (cur) => pruneForPorts(cur, mixer.id, ports).setup)
  }
  // A placeholder tablet becomes the real device (2026-11-07, the admin links by hand): what the map
  // had already added for that device on its own moves into it and goes.
  const linkDevice = async (item: StageEquipment) => {
    const taken = new Set(equipment.filter((e) => e.kind === 'stageboard' && e.deviceId && e.id !== `device:${e.deviceId}`).map((e) => e.deviceId))
    const options = devices.filter((d) => !d.revoked && !taken.has(d.id)).map((d) => ({ value: d.id, label: d.name }))
    if (options.length === 0) return
    const answer = await promptFields(t('map.linkTitle', { name: item.name }), [{ key: 'device', label: t('map.linkDevice'), type: 'radio', options, defaultValue: options[0]!.value }], t('map.link'))
    if (!answer?.device) return
    const { linked, merge } = linkPlaceholder({ equipment, setups }, item, answer.device)
    // The placeholder first: until it carries the device id, the map would add the device again.
    await saveEquipment(linked)
    if (!merge) return
    for (const s of setups) await updateSetup(s.id, (cur) => mergeEquipmentInSetup(cur, merge, item.id))
    await removeEquipment(merge)
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
      const routing = { ...s.routing }
      delete routing[itemId]
      return { ...s, positions, routing, links: s.links.filter((l) => !gone.includes(l.id)) }
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

  const removeLink = (link: StageLink) => setup && void updateSetup(setup.id, (s) => ({ ...s, links: s.links.filter((l) => l.id !== link.id) })).then(() => setSelection(null))
  // A tick in a free matrix: the setup keeps the device's whole crosspoint list from then on.
  const toggleCross = (item: StageEquipment, from: MatrixPoint, to: MatrixPoint, on: boolean) =>
    setup &&
    void updateSetup(setup.id, (s) => {
      const current = effectiveRouting(item, s).filter((c) => !(samePoint(c.from, from) && samePoint(c.to, to)))
      return { ...s, routing: { ...s.routing, [item.id]: on ? [...current, { from, to }] : current } }
    })

  // The rows and columns of a device's matrix: physical ports, one line per channel, and on a
  // StageBoard device its virtual sources (columns) and virtual inputs (rows).
  const matrixOf = (item: StageEquipment): { columns: MatrixLine[]; rows: MatrixLine[] } => {
    const lines = (ports: Port[]): MatrixLine[] =>
      ports.flatMap((p) =>
        p.channels
          ? Array.from({ length: p.channels }, (_, i) => ({ key: `${p.id}#${i + 1}`, label: `${p.name} ${i + 1}`, point: { kind: 'port' as const, portId: p.id, channel: i + 1 } }))
          : [{ key: p.id, label: p.name, point: { kind: 'port' as const, portId: p.id } }],
      )
    const virtualLines = (input: boolean): MatrixLine[] =>
      DRIVER_KINDS.includes(item.kind) ? virtualPorts.filter((v) => v.input === input).map((v) => ({ key: `v:${v.id}`, label: v.name, point: { kind: 'virtual' as const, virtualPortId: v.id } })) : []
    return {
      columns: [...virtualLines(false), ...lines(item.ports.filter((p) => p.direction !== 'out'))],
      rows: [...lines(item.ports.filter((p) => p.direction !== 'in')), ...virtualLines(true)],
    }
  }

  // A signal's way, cable by cable: "Redmi Dev · Kopfhörer → Pult · Eingang 15".
  // Branch by branch: each cable followed by the cables leaving where it arrives.
  const wayOf = (flow: SignalFlow) => {
    const ordered: SignalFlow['hops'] = []
    const visit = (equipmentId: string) => {
      for (const hop of flow.hops) {
        if (hop.from.equipmentId !== equipmentId || ordered.includes(hop)) continue
        ordered.push(hop)
        visit(hop.to.equipmentId)
      }
    }
    visit(flow.originEquipmentId)
    return [...ordered, ...flow.hops.filter((h) => !ordered.includes(h))].map((h) => `${portLabel(h.from)} → ${portLabel(h.to)}`)
  }
  const endsOf = (flow: SignalFlow) => [
    ...flow.listenerIds.map(listenerName),
    ...flow.virtualInputs.map((v) => `${byId.get(v.equipmentId)?.name ?? ''} · ${virtualPorts.find((p) => p.id === v.virtualPortId)?.name ?? v.virtualPortId}`),
  ]
  const signalLabel = (flow: SignalFlow) => {
    const origin = byId.get(flow.originEquipmentId)
    return DRIVER_KINDS.includes(origin?.kind ?? 'person') ? `${flow.name} (${origin?.name ?? ''})` : flow.name
  }

  if (!loaded || !setup) return <p className="mb-6 text-base text-ink-muted">{t('map.loading')}</p>

  const selectedNode = selection?.kind === 'node' ? byId.get(selection.id) : undefined
  const selectedLink = selection?.kind === 'link' || selection?.kind === 'signal' ? setup.links.find((l) => l.id === (selection.kind === 'link' ? selection.id : selection.linkId)) : undefined
  // The signals whose full way is shown: all on a cable tapped twice, or the one tapped.
  const chainFlows = selection?.kind === 'signal' ? flows.filter((f) => f.key === selection.key) : selection?.kind === 'link' && selection.chain && selectedLink ? flowsOn(selectedLink.id) : []
  const highlighted = new Set<string>()
  for (const f of chainFlows) f.hops.forEach((h) => highlighted.add(h.linkId))
  if (selectedLink && chainFlows.length === 0) highlighted.add(selectedLink.id)
  if (selectedNode) for (const l of setup.links) if (l.from.equipmentId === selectedNode.id || l.to.equipmentId === selectedNode.id) highlighted.add(l.id)
  const linkLabel = (l: StageLink) => {
    const names = [...new Set(flowsOn(l.id).map((f) => f.name))]
    return names.length > 3 ? [...names.slice(0, 2), `+${names.length - 2}`] : names
  }

  return (
    // Full screen on the page layer, not takeover: adding equipment, copying a setup and every
    // confirm open as dialogs - above takeover they would be hidden behind the map (2026-11-07).
    // Panning sideways is the map's own gesture, not a swipe to the next tab (useTabSwipe.ts).
    <section data-no-tab-swipe className={full ? 'fixed inset-0 z-page flex flex-col bg-stage p-2' : 'mb-6'}>
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
                  if (connectFrom) return
                  // Tapped again: the full way of every signal on it.
                  setSelection((prev) => (prev?.kind === 'link' && prev.id === l.id ? { ...prev, chain: true } : { kind: 'link', id: l.id, chain: false }))
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
                        <button key={l.id} type="button" className="block text-left text-ink-soft underline" onClick={() => setSelection({ kind: 'link', id: l.id, chain: false })}>
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
            {selectedNode.routing && (() => {
              const { columns, rows } = matrixOf(selectedNode)
              if (columns.length === 0 || rows.length === 0) return null
              const crosspoints = effectiveRouting(selectedNode, setup)
              const fixedRouting = selectedNode.routing.mode === 'fixed'
              return (
                <div className="flex flex-col gap-1">
                  <span className="text-base font-semibold">
                    {t('map.matrix')}
                    {fixedRouting && <span className="font-normal text-ink-muted"> · {t('map.matrixFixed')}</span>}
                  </span>
                  <RoutingMatrix
                    label={t('map.matrixOf', { name: title(selectedNode) })}
                    columns={columns}
                    rows={rows}
                    routed={(from, to) => crosspoints.some((c) => samePoint(c.from, from) && samePoint(c.to, to))}
                    fixed={fixedRouting}
                    editable={selectedNode.kind === 'stageboard' || selectedNode.kind === 'stage-server' ? canWire(selectedNode) : canGear}
                    onToggle={(from, to, on) => toggleCross(selectedNode, from, to, on)}
                  />
                </div>
              )
            })()}
            {canGear && (
              <div className="flex flex-wrap gap-2">
                <Button icon="rename" onClick={() => void renameEquipment(selectedNode)}>
                  {t('map.rename')}
                </Button>
                {selectedNode.kind === 'mixer' && <Button onClick={() => setMixerFor(selectedNode)}>{t('map.setUp')}</Button>}
                {selectedNode.kind === 'stageboard' && !selectedNode.deviceId && <Button onClick={() => void linkDevice(selectedNode)}>{t('map.link')}</Button>}
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
            ends={[portLabel(selectedLink.from), portLabel(selectedLink.to)]}
            twoWay={portOf(byId.get(selectedLink.from.equipmentId), selectedLink.from.portId)?.direction === 'both' && portOf(byId.get(selectedLink.to.equipmentId), selectedLink.to.portId)?.direction === 'both'}
            adapter={(() => {
              const a = portOf(byId.get(selectedLink.from.equipmentId), selectedLink.from.portId)
              const b = portOf(byId.get(selectedLink.to.equipmentId), selectedLink.to.portId)
              return a && b ? (portFit(a, b)?.adapter ?? false) : false
            })()}
            signals={flowsOn(selectedLink.id).map((f) => ({ key: f.key, label: signalLabel(f), selected: selection?.kind === 'signal' && selection.key === f.key }))}
            chains={chainFlows.map((f) => ({ key: f.key, label: signalLabel(f), cls: f.signalClass, way: wayOf(f), ends: endsOf(f) }))}
            onSignal={(key) => setSelection({ kind: 'signal', key, linkId: selectedLink.id })}
            onChain={() => setSelection({ kind: 'link', id: selectedLink.id, chain: true })}
            removable={canWireLink(selectedLink)}
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
      {mixerFor && <MixerSetupDialog mixer={mixerFor} onClose={() => setMixerFor(null)} onSave={(m) => void setUpMixer(mixerFor, m)} />}
    </section>
  )
}

function LinkPanel(props: {
  ends: [string, string]
  twoWay: boolean
  adapter: boolean
  signals: { key: string; label: string; selected: boolean }[]
  chains: { key: string; label: string; cls: SignalClass; way: string[]; ends: string[] }[]
  onSignal: (key: string) => void
  onChain: () => void
  removable: boolean
  onRemove: () => void
}) {
  const { t } = useTranslation('hardware')
  return (
    <div className="flex flex-col gap-3 rounded-container border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 text-lg font-bold">
          {props.ends[0]} {props.twoWay ? '↔' : '→'} {props.ends[1]}
        </span>
        {props.adapter && <Badge tone="warning">{t('map.adapter')}</Badge>}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-base font-semibold">{t('map.onCable')}</span>
        {props.signals.length === 0 ? (
          <span className="text-base text-ink-muted">{t('map.nothingOnCable')}</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            {props.signals.map((s) => (
              <Button key={s.key} variant={s.selected ? 'primary' : 'secondary'} onClick={() => props.onSignal(s.key)}>
                {s.label}
              </Button>
            ))}
            {props.chains.length === 0 && (
              <Button variant="quiet" onClick={props.onChain}>
                {t('map.showWay')}
              </Button>
            )}
          </div>
        )}
      </div>
      {props.chains.map((c) => (
        <div key={c.key} className="flex flex-col gap-1">
          <span className="text-base font-semibold">
            {c.label} <span className="font-normal text-ink-muted">· {t(`map.class.${c.cls}`)}</span>
          </span>
          <ol className="flex flex-col gap-0.5 pl-3 text-base">
            {c.way.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <span className="pl-3 text-base text-ink-muted">{c.ends.length > 0 ? t('map.reaches', { who: c.ends.join(', ') }) : t('map.nowhere')}</span>
        </div>
      ))}
      {props.removable && (
        <div>
          <Button variant="danger" icon="delete" onClick={props.onRemove}>
            {t('map.removeLink')}
          </Button>
        </div>
      )}
    </div>
  )
}
