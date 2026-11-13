import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SHOW_STATE, type StageSetup } from 'shared-types'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))

const { useShowStateStore } = await import('../store/useShowStateStore')
const { useStageMapStore } = await import('../store/useStageMapStore')
const { GigSetupPicker } = await import('./GigSetupPicker')

const setActiveSetup = vi.fn(async () => {})
const setup = (id: string, name: string): StageSetup => ({ id, name, positions: {}, links: [], routing: {} })

function show(state: Partial<typeof DEFAULT_SHOW_STATE> & { activeSetupId?: string | null }, isMaster = true) {
  useShowStateStore.setState({ setActiveSetup, isMaster, state: { ...DEFAULT_SHOW_STATE, ...state } })
  // useOutputPlan's part: the chosen setup into the map.
  useStageMapStore.setState({ active: state.activeSetupId ?? undefined })
}

beforeEach(() => {
  setActiveSetup.mockClear()
  useStageMapStore.setState({ setups: [setup('club', 'Club'), setup('standard', 'Standard')], equipment: [], loaded: true })
  show({})
})

describe('GigSetupPicker (☰, #745)', () => {
  it('shows the setup that applies - "Standard" until the master picks another', async () => {
    render(<GigSetupPicker />)
    fireEvent.click(screen.getByRole('button', { name: /Standard/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Club/ }))
    await waitFor(() => expect(setActiveSetup).toHaveBeenCalledWith('club'))
  })

  it('shows the chosen one, also on a device that is not the master - which cannot change it', () => {
    show({ activeSetupId: 'club' }, false)
    render(<GigSetupPicker />)
    expect(screen.getByText('Club')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Club/ })).toBeNull()
  })
})
