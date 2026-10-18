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
const { useLogicalDevicesStore } = await import('../store/useLogicalDevicesStore')

describe('ActionDialog', () => {
  it('"Folge": two steps with a bar between them, chosen right here - no Folge inside a Folge', () => {
    const onSave = vi.fn()
    render(<ActionDialog title="Beim Drücken" initial={null} onSave={onSave} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Folge' }))
    const choose = (step: number, label: string) => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Wählen' }).slice(-1)[0]!)
      const picker = screen.getByRole('dialog', { name: `Schritt ${step + 1}` })
      expect(within(picker).queryByRole('radio', { name: 'Folge' })).toBeNull()
      fireEvent.click(within(picker).getByRole('radio', { name: 'Wiedergabe' }))
      fireEvent.click(within(picker).getByRole('radio', { name: label }))
      fireEvent.click(within(picker).getByRole('button', { name: 'Übernehmen' }))
    }
    choose(0, 'Klick an')
    fireEvent.click(screen.getByRole('button', { name: 'Schritt hinzufügen' }))
    choose(1, 'Klick aus')
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))
    expect(onSave).toHaveBeenCalledWith({
      kind: 'steps',
      steps: [
        { wait: null, action: { kind: 'playback', op: 'click-on' } },
        { wait: { amount: 1, unit: 'bars' }, action: { kind: 'playback', op: 'click-off' } },
      ],
    })
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

