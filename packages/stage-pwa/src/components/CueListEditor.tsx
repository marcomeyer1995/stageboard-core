import { useState } from 'react'
import { CAPABILITIES, type CapabilityId, type ShowCue } from 'shared-types'
import { randomId } from '../lib/id'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'

const CAPABILITY_OPTIONS = Object.values(CAPABILITIES)

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

interface CueListEditorProps {
  cues: ShowCue[]
  onChange: (cues: ShowCue[]) => void
}

/**
 * Generic add/edit/remove UI for a SongVariant's cues (#99) - a plain type/payload-as-JSON
 * editor, not a per-plugin authoring panel (docs/00 §6's `registerEditorPanel` hook is a later,
 * per-plugin slice). `targetLogicalDeviceId` is scoped to whichever Logical Devices declare the
 * chosen capability, so two Logical Devices sharing one (two guitarists' Kempers) each get
 * picked explicitly rather than the cue guessing which physical unit it's for.
 */
export function CueListEditor({ cues, onChange }: CueListEditorProps) {
  const logicalDevices = useLogicalDevicesStore((state) => state.devices)
  const [capability, setCapability] = useState<CapabilityId>(CAPABILITY_OPTIONS[0])
  const [targetLogicalDeviceId, setTargetLogicalDeviceId] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [type, setType] = useState('')
  const [payloadText, setPayloadText] = useState('')
  const [payloadError, setPayloadError] = useState<string | null>(null)

  const devicesForCapability = logicalDevices.filter((device) => device.capability === capability)

  function nameFor(logicalDeviceId: string): string {
    return logicalDevices.find((device) => device.id === logicalDeviceId)?.name ?? logicalDeviceId
  }

  function add() {
    if (!targetLogicalDeviceId || !type.trim()) return
    let payload: Record<string, unknown> | undefined
    if (payloadText.trim()) {
      try {
        payload = JSON.parse(payloadText) as Record<string, unknown>
      } catch {
        setPayloadError('Ungültiges JSON')
        return
      }
    }
    setPayloadError(null)
    const cue: ShowCue = {
      id: randomId(),
      timeMs: Math.round(seconds * 1000),
      targetLogicalDeviceId,
      type: type.trim(),
      payload,
    }
    onChange([...cues, cue].sort((a, b) => a.timeMs - b.timeMs))
    setType('')
    setPayloadText('')
  }

  function remove(id: string) {
    onChange(cues.filter((cue) => cue.id !== id))
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-muted">Cues</p>
      {cues.length === 0 && <p className="text-xs text-ink-faint">Noch keine Cues für diese Variante.</p>}
      {cues.map((cue) => (
        <div
          key={cue.id}
          className="flex items-center gap-3 rounded-sb-sm bg-control px-3 py-2 text-sm text-ink-soft"
        >
          <span className="font-sb-mono text-ink">{formatTime(cue.timeMs)}</span>
          <span className="flex-1">
            {nameFor(cue.targetLogicalDeviceId)} <span className="text-xs text-ink-faint">· {cue.type}</span>
          </span>
          <button
            type="button"
            onClick={() => remove(cue.id)}
            className="rounded-sb-sm bg-control-strong px-2 py-1 text-xs text-ink-soft hover:bg-control-strong-hover"
          >
            Entfernen
          </button>
        </div>
      ))}

      <div className="flex flex-col gap-2 rounded-sb-sm border border-dashed border-line p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Zeit (s)
            <input
              type="number"
              min={0}
              value={seconds}
              onChange={(e) => setSeconds(Number(e.target.value))}
              className="w-20 rounded-sb-sm bg-control px-2 py-1 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Capability
            <select
              value={capability}
              onChange={(e) => {
                setCapability(e.target.value)
                setTargetLogicalDeviceId('')
              }}
              className="rounded-sb-sm bg-control px-2 py-1 text-sm text-ink"
            >
              {CAPABILITY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs text-ink-muted">
            Ziel-Gerät
            <select
              value={targetLogicalDeviceId}
              onChange={(e) => setTargetLogicalDeviceId(e.target.value)}
              disabled={devicesForCapability.length === 0}
              className="rounded-sb-sm bg-control px-2 py-1 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <option value="">
                {devicesForCapability.length === 0 ? 'Kein Logical Device mit dieser Capability' : 'Wählen…'}
              </option>
              {devicesForCapability.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs text-ink-muted">
            Typ
            <input
              type="text"
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="z.B. rig_change"
              className="rounded-sb-sm bg-control px-2 py-1 text-sm text-ink placeholder:text-ink-faint"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Payload (JSON, optional)
          <textarea
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
            placeholder='{"rigName": "Clean Chorus", "slot": 3}'
            rows={2}
            className="rounded-sb-sm bg-control px-2 py-1 font-sb-mono text-xs text-ink placeholder:text-ink-faint"
          />
        </label>
        {payloadError && <p className="text-xs text-red-500">{payloadError}</p>}
        <button
          type="button"
          onClick={add}
          disabled={!targetLogicalDeviceId || !type.trim()}
          className="self-start rounded-sb-sm bg-control-strong px-3 py-1 text-sm font-medium text-accent hover:bg-control-strong-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          Cue hinzufügen
        </button>
      </div>
    </div>
  )
}
