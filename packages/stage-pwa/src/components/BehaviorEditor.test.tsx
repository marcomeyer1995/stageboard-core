import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))

const { BehaviorEditor } = await import('./BehaviorEditor')
const { useSwitchesStore } = await import('../store/useSwitchesStore')

describe('BehaviorEditor - switches (docs/23 §11)', () => {
  it('"Als Schalter speichern": the own setup becomes a band-wide switch, and the trigger points to it', async () => {
    const save = vi.fn(async (sw: { id: string; name: string }) => void useSwitchesStore.setState({ switches: [sw as never] }))
    useSwitchesStore.setState({ switches: [], save })
    const onChange = vi.fn()
    render(<BehaviorEditor initial={null} onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Eigene Belegung' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Wählen' })[0]!)
    const picker = screen.getByRole('dialog', { name: 'Beim Drücken' })
    fireEvent.click(within(picker).getByRole('radio', { name: 'Wiedergabe' }))
    fireEvent.click(within(picker).getByRole('radio', { name: 'Klick an/aus' }))
    fireEvent.click(within(picker).getByRole('button', { name: 'Übernehmen' }))

    fireEvent.click(screen.getByRole('button', { name: 'Als Schalter speichern…' }))
    const dialog = screen.getByRole('dialog', { name: 'Neuer Schalter' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Klick' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))

    await vi.waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Klick', behavior: { kind: 'momentary', press: { kind: 'playback', op: 'click-toggle' }, release: { kind: 'none' } } }),
      ),
    )
    const saved = save.mock.calls[0]![0]
    await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ kind: 'switch', switchId: saved.id }))
    expect(screen.getByRole('radio', { name: 'Klick' })).toHaveAttribute('aria-checked', 'true')
  })
})
