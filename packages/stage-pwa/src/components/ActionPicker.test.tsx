import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))

const { ActionDialog } = await import('./ActionPicker')
const { useActionSequencesStore } = await import('../store/useActionSequencesStore')
const { useLogicalDevicesStore } = await import('../store/useLogicalDevicesStore')

describe('ActionDialog - "Ablauf" (docs/23 §3)', () => {
  it('a new sequence: name, two steps with a bar between them, saved and chosen', async () => {
    const save = vi.fn(async () => {})
    useActionSequencesStore.setState({ sequences: [], save })
    const onSave = vi.fn()
    render(<ActionDialog title="Beim Drücken" initial={null} onSave={onSave} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Ablauf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Neuer Ablauf' }))
    const editor = screen.getByRole('dialog', { name: 'Neuer Ablauf' })
    fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: 'Solo' } })

    const choose = (step: number, label: string) => {
      fireEvent.click(within(editor).getAllByRole('button', { name: 'Wählen' }).slice(-1)[0]!)
      const picker = screen.getByRole('dialog', { name: `Schritt ${step + 1}` })
      // No sequence within a sequence.
      expect(within(picker).queryByRole('radio', { name: 'Ablauf' })).toBeNull()
      fireEvent.click(within(picker).getByRole('radio', { name: 'Wiedergabe' }))
      fireEvent.click(within(picker).getByRole('radio', { name: label }))
      fireEvent.click(within(picker).getByRole('button', { name: 'Übernehmen' }))
    }
    choose(0, 'Klick an/aus')
    fireEvent.click(within(editor).getByRole('button', { name: 'Schritt hinzufügen' }))
    choose(1, 'Tempo +1 %')
    fireEvent.click(within(editor).getByRole('button', { name: 'Speichern' }))

    await vi.waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        id: expect.any(String),
        name: 'Solo',
        steps: [
          { wait: null, action: { kind: 'playback', op: 'click-toggle' } },
          { wait: { amount: 1, unit: 'bars' }, action: { kind: 'playback', op: 'tempo-up' } },
        ],
      }),
    )
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Neuer Ablauf' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))
    expect(onSave).toHaveBeenCalledWith({ kind: 'sequence', sequenceId: expect.any(String) })
  })

  it('"Gerät" lists only devices with ready-made commands, and not the timeline\'s "Wiedergabe" entry (Marco, 2026-10-18)', () => {
    useLogicalDevicesStore.setState({
      devices: [
        { id: 'k', name: 'Kemper', capability: 'kemper-control', pluginId: 'kemper-profiler', executionTarget: null },
        { id: 'c', name: 'Kemper Clock', capability: 'midi-clock', pluginId: 'midi-clock', executionTarget: null },
      ],
    })
    render(<ActionDialog title="Beim Drücken" initial={null} onSave={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Gerät' }))
    fireEvent.click(screen.getByRole('button', { name: 'Gerät und Befehl wählen' }))
    const deviceSelect = within(screen.getByRole('dialog', { name: 'Gerät steuern' })).getAllByRole('combobox')[0]!
    const options = within(deviceSelect).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Gerät wählen…', 'Kemper'])
  })

  it('"Wiedergabe" offers Klick an, Klick aus and Klick wie im Song besides an/aus', () => {
    render(<ActionDialog title="Beim Drücken" initial={null} onSave={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Wiedergabe' }))
    for (const name of ['Klick an', 'Klick aus', 'Klick an/aus', 'Klick wie im Song']) expect(screen.getByRole('radio', { name })).toBeInTheDocument()
  })
})

