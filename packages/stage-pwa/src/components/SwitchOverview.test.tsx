import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))

const { SwitchOverview } = await import('./SwitchOverview')
const { useSwitchesStore } = await import('../store/useSwitchesStore')

describe('SwitchOverview (#877)', () => {
  it('the list sits behind one row with its count; a switch still opens its editor', () => {
    useSwitchesStore.setState({
      switches: [
        { id: 'blinder', name: 'Blinder', color: 'accent', behavior: { kind: 'momentary', press: { kind: 'playback', op: 'click-toggle' }, release: { kind: 'none' } } },
        { id: 'talkback', name: 'Talkback', color: 'neutral', behavior: { kind: 'momentary', press: { kind: 'playback', op: 'click-toggle' }, release: { kind: 'none' } } },
      ] as never,
      states: {},
    })
    render(<SwitchOverview />)

    // One row on the Band page (#877), the list only after tapping it.
    expect(screen.queryByRole('button', { name: /Blinder/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Neuer Schalter' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Schalter: 2 Schalter' }))

    const list = screen.getByRole('dialog', { name: 'Schalter' })
    expect(screen.getByRole('button', { name: /Blinder/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Neuer Schalter' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Blinder/ }))
    expect(screen.getByRole('dialog', { name: 'Schalter bearbeiten' })).toBeInTheDocument()
    expect(list).toBeInTheDocument()
  })
})
