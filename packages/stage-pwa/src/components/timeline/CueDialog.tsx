import { useState } from 'react'
import type { LogicalDevice, ShowCue } from 'shared-types'
import { commandsFor, fieldOptions, payloadFromAnswers } from '../../lib/deviceCommands'
import { parseCuePayload } from '../../lib/timelineCues'
import { INPUT } from '../ui/styles'
import { Button, Dialog } from '../ui'

export type CueContent = Omit<ShowCue, 'id' | 'timeMs'>

/**
 * The cue form in one window (Marco, 2026-09-28): a dropdown for the device, one for its command,
 * then one per value of that command - each greyed out until the one before it is chosen, then
 * filled with what fits. A musician picks "NUX MG-30 → Patch wählen → 02B", never a MIDI number.
 * A device whose module describes no commands (lib/deviceCommands) gets the free-text command and
 * JSON payload of the cue list instead. Same look as the app's other dialogs (DialogHost.tsx).
 */
export function CueDialog({
  title,
  devices,
  initial,
  onSubmit,
  onCancel,
}: {
  title: string
  devices: readonly LogicalDevice[]
  initial?: CueContent
  onSubmit: (content: CueContent) => void
  onCancel: () => void
}) {
  const [deviceId, setDeviceId] = useState(initial?.targetLogicalDeviceId ?? '')
  const device = devices.find((d) => d.id === deviceId)
  const commands = device ? commandsFor(device.capability) : []
  const [commandType, setCommandType] = useState(initial && commands.some((c) => c.type === initial.type) ? initial.type : '')
  const command = commands.find((c) => c.type === commandType)
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initial?.payload ?? {}).map(([key, value]) => [key, String(value)])),
  )
  // Devices without described commands: the cue list's free-text fields.
  const [freeType, setFreeType] = useState(initial?.type ?? '')
  const [freePayload, setFreePayload] = useState(initial?.payload ? JSON.stringify(initial.payload) : '')
  const [error, setError] = useState<string | null>(null)

  const free = device !== undefined && commands.length === 0
  const complete = free ? freeType.trim().length > 0 : command !== undefined && command.fields.every((f) => (answers[f.key] ?? '') !== '')

  function submit() {
    if (!device) return
    if (free) {
      const parsed = parseCuePayload(freePayload)
      if ('error' in parsed) {
        setError(parsed.error)
        return
      }
      onSubmit({ targetLogicalDeviceId: device.id, type: freeType.trim(), payload: parsed.payload })
      return
    }
    if (!command) return
    const parsed = payloadFromAnswers(command.fields, answers)
    if ('error' in parsed) {
      setError(parsed.error)
      return
    }
    onSubmit({ targetLogicalDeviceId: device.id, type: command.type, payload: command.fields.length > 0 ? parsed.payload : undefined })
  }

  const select = `min-h-form px-3 text-base ${INPUT}`
  const label = 'block text-sm font-semibold text-ink-soft'

  return (
    <Dialog
      title={title}
      size="s"
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onCancel}>Abbrechen</Button>
          <Button variant="primary" disabled={!complete} onClick={submit}>
            Übernehmen
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >

        <label className={label}>
          <span className="mb-1 block">Gerät</span>
          <select
            className={select}
            value={deviceId}
            onChange={(e) => {
              setDeviceId(e.target.value)
              setCommandType('')
              setAnswers({})
              setError(null)
            }}
          >
            <option value="" disabled>
              Gerät wählen…
            </option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

        {free ? (
          <>
            <label className={label}>
              <span className="mb-1 block">Befehl (Typ)</span>
              <input className={select} value={freeType} onChange={(e) => setFreeType(e.target.value)} />
            </label>
            <label className={label}>
              <span className="mb-1 block">Payload (JSON, optional)</span>
              <textarea rows={3} className={`px-3 py-2 ${INPUT}`} value={freePayload} onChange={(e) => setFreePayload(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <label className={label}>
              <span className="mb-1 block">Befehl</span>
              <select
                className={select}
                value={commandType}
                disabled={!device}
                onChange={(e) => {
                  setCommandType(e.target.value)
                  setAnswers({})
                  setError(null)
                }}
              >
                <option value="" disabled>
                  {device ? 'Befehl wählen…' : 'Erst ein Gerät wählen'}
                </option>
                {commands.map((c) => (
                  <option key={c.type} value={c.type}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            {(command?.fields ?? [{ key: '__placeholder', label: 'Wert', kind: 'bool' as const }]).map((field, i, fields) => {
              // Each value opens once the command and every value before it are chosen.
              const enabled = command !== undefined && fields.slice(0, i).every((f) => (answers[f.key] ?? '') !== '')
              return (
                <label key={field.key} className={label}>
                  <span className="mb-1 block">{field.label}</span>
                  <select
                    className={select}
                    value={command ? (answers[field.key] ?? '') : ''}
                    disabled={!enabled}
                    onChange={(e) => {
                      setAnswers((prev) => ({ ...prev, [field.key]: e.target.value }))
                      setError(null)
                    }}
                  >
                    <option value="" disabled>
                      {!command ? 'Erst einen Befehl wählen' : enabled ? `${field.label} wählen…` : 'Erst den Wert davor wählen'}
                    </option>
                    {command &&
                      fieldOptions(field).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                  </select>
                </label>
              )
            })}
          </>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </Dialog>
  )
}
