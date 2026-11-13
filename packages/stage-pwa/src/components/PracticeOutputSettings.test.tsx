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
    expect(screen.getByRole('radio', { name: /Alles auf beide Ohren/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: /Wie im Aufbau „Standard“/ }))
    expect(usePracticeOutputStore.getState().setupId).toBe('standard')
    expect(localStorage.getItem('sb:audio:practiceSetup')).toBe('standard')
    expect(screen.getByRole('radio', { name: /Wie im Aufbau „Standard“/ })).toHaveAttribute('aria-checked', 'true')
  })
})
