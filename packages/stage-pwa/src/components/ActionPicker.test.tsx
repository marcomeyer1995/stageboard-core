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
})
