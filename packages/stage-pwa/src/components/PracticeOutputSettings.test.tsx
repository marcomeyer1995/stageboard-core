import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultStageMap } from 'shared-types'
// workspaceDb.ts constructs a real PouchDB at module load time - unavailable under happy-dom.
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

import { usePracticeOutputStore } from '../lib/outputPlan'
import { useStageMapStore } from '../store/useStageMapStore'
import { PracticeOutputSettings } from './PracticeOutputSettings'

afterEach(() => {
  usePracticeOutputStore.getState().setSetupId(null)
  localStorage.clear()
})

describe('PracticeOutputSettings (#742)', () => {
  it('starts on both ears and switches to a setup of the band, kept per device', () => {
    useStageMapStore.setState({ ...defaultStageMap([{ id: 'redmi', name: 'Redmi' }]), loaded: true })
    render(<PracticeOutputSettings />)
    const select = screen.getByRole('combobox', { name: 'Ausgang beim Üben' }) as HTMLSelectElement
    expect(select.value).toBe('')
    expect(screen.getByText(/braucht keine Karte/)).toBeInTheDocument()
    fireEvent.change(select, { target: { value: (screen.getByRole('option', { name: 'Wie im Aufbau „Standard“' }) as HTMLOptionElement).value } })
    expect(usePracticeOutputStore.getState().setupId).toBe('standard')
    expect(localStorage.getItem('sb:audio:practiceSetup')).toBe('standard')
    expect(select.value).toBe('standard')
    expect(screen.getByText(/wie in der Matrix dieses Geräts/)).toBeInTheDocument()
  })
})
