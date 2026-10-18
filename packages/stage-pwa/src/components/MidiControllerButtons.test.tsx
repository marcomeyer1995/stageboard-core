import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))

const { MidiControllerButtonsDialog } = await import('./MidiControllerButtons')
const { useMidiControllerRulesStore } = await import('../store/useMidiControllerRulesStore')
const { midiLearn } = await import('../lib/useMidiControllers')
const { getDeviceId } = await import('../lib/deviceId')

const controller = { id: 'fcb', name: 'FCB', capability: 'midi-controller', pluginId: 'midi-controller', executionTarget: getDeviceId() }

describe('Knöpfe belegen (#547 step 2)', () => {
  it('learns a button by pressing it, then saves it with its action', async () => {
    const save = vi.fn(async () => {})
    useMidiControllerRulesStore.setState({ docs: [], save })
    render(<MidiControllerButtonsDialog device={controller} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Neuer Knopf' }))
    const dialog = screen.getByRole('dialog', { name: 'Neuer Knopf' })
    expect(within(dialog).getByText('Jetzt Knopf am Controller drücken …')).toBeInTheDocument()
    act(() => midiLearn.capture?.('fcb', { message: 'cc', channel: 2, number: 80, value: 127, edge: 'press' }))
    expect(within(dialog).getByText('CC 80 · Kanal 2')).toBeInTheDocument()
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Wählen' })[0]!)
    const picker = screen.getByRole('dialog', { name: 'Beim Drücken' })
    fireEvent.click(within(picker).getByRole('radio', { name: 'Nächster Song' }))
    fireEvent.click(within(picker).getByRole('button', { name: 'Übernehmen' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))
    expect(save).toHaveBeenCalledWith({
      id: 'fcb',
      rules: [expect.objectContaining({ trigger: { message: 'cc', channel: 2, number: 80 }, behavior: { kind: 'momentary', press: { kind: 'show', op: 'next' }, release: { kind: 'none' } } })],
    })
  })

  it('on another tablet: no learning, the button is entered by hand', () => {
    useMidiControllerRulesStore.setState({ docs: [] })
    render(<MidiControllerButtonsDialog device={{ ...controller, executionTarget: 'other-tablet' }} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Neuer Knopf' }))
    const dialog = screen.getByRole('dialog', { name: 'Neuer Knopf' })
    expect(within(dialog).queryByText('Jetzt Knopf am Controller drücken …')).toBeNull()
    expect(within(dialog).getByText(/Lernen geht nur am Tablet/)).toBeInTheDocument()
  })
})
