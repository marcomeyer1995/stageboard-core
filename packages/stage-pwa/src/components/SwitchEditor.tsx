import { useState } from 'react'
import type { Behavior } from '../lib/actions'
import type { Switch } from '../lib/switches'
import { useDialogStore } from '../store/useDialogStore'
import { useSwitchesStore } from '../store/useSwitchesStore'
import { WIDGET_COLORS, type WidgetColor } from '../widgets/widgetColors'
import { BehaviorEditor } from './BehaviorEditor'
import { Button, Dialog, Field, Select } from './ui'

function newSwitchId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const COLOR_LABEL: Record<WidgetColor, string> = { neutral: 'Neutral', accent: 'Akzent', green: 'Grün', amber: 'Gelb', red: 'Rot' }

/**
 * A switch (docs/23 §11): name, colour, behaviour and actions - for the whole band. `initial`
 * without an id: a new switch, optionally prefilled ("Als Schalter speichern").
 */
export function SwitchDialog({ initial, onSaved, onClose }: { initial: (Partial<Switch> & { behavior?: Behavior }) | null; onSaved: (sw: Switch) => void; onClose: () => void }) {
  const save = useSwitchesStore((state) => state.save)
  const remove = useSwitchesStore((state) => state.remove)
  const confirm = useDialogStore((state) => state.confirm)
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState<WidgetColor>(initial?.color ?? 'accent')
  const [behavior, setBehavior] = useState<Behavior | null>(initial?.behavior ?? null)
  const existing = initial?.id ? initial : null

  async function submit() {
    if (!behavior || !name.trim()) return
    const sw: Switch = { id: existing?.id ?? newSwitchId(), name: name.trim(), color, behavior }
    await save(sw)
    onSaved(sw)
  }

  return (
    <Dialog
      title={existing ? 'Schalter bearbeiten' : 'Neuer Schalter'}
      onClose={onClose}
      actions={
        <>
          {existing ? (
            <Button
              variant="danger"
              onClick={async () => {
                if (!(await confirm(`Schalter „${existing.name}“ löschen? Pedale, MIDI-Knöpfe und Dashboard-Knöpfe, die ihn auslösen, tun dann nichts mehr.`, { confirmLabel: 'Löschen', danger: true })))
                  return
                await remove(existing.id!)
                onClose()
              }}
            >
              Löschen
            </Button>
          ) : (
            <Button onClick={onClose}>Abbrechen</Button>
          )}
          <Button variant="primary" disabled={!behavior || !name.trim()} onClick={() => void submit()}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">Gilt für die ganze Band. Jede Änderung wirkt auf alle Pedale, MIDI-Knöpfe und Dashboard-Knöpfe, die ihn auslösen.</p>
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Blinder" />
        <Select label="Farbe" value={color} onChange={(e) => setColor(e.target.value as WidgetColor)} options={WIDGET_COLORS.map((c) => ({ value: c, label: COLOR_LABEL[c] }))} />
        <BehaviorEditor initial={behavior} onChange={setBehavior} allowSwitch={false} />
      </div>
    </Dialog>
  )
}
