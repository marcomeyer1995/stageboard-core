import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    async allDocs() {
      return { rows: [] }
    }
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))
vi.mock('../lib/stageServer', () => ({ getStageServerUrl: () => 'https://192.168.178.158' }))

const { OscInputButtonsDialog } = await import('./OscInputButtons')
const { oscLearn } = await import('../lib/useOscInput')
const { useOscInputRulesStore } = await import('../store/useOscInputRulesStore')

const device = { id: 'touch', name: 'TouchOSC', capability: 'osc-input', pluginId: 'osc-input', executionTarget: 'server' } as never

beforeEach(() => {
  useOscInputRulesStore.setState({ docs: [], learning: false })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ port: 8000 }) })))
})

describe('OscInputButtonsDialog (#484)', () => {
  it('says where the controller sends to', async () => {
    render(<OscInputButtonsDialog device={device} onClose={vi.fn()} />)
    expect(screen.getByText('192.168.178.158')).toBeInTheDocument()
    expect(await screen.findByText('8000')).toBeInTheDocument()
    expect(screen.getByText('Noch kein Knopf belegt.')).toBeInTheDocument()
  })

  it('learns a button: the device listens while waiting, the pressed address is filled in', () => {
    render(<OscInputButtonsDialog device={device} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Neuer Knopf'))
    expect(screen.getByText('Jetzt Knopf am Controller drücken …')).toBeInTheDocument()
    expect(useOscInputRulesStore.getState().learning).toBe(true)
    act(() => oscLearn.capture?.({ address: '/scene', args: [4], at: 1 }))
    expect(screen.getByLabelText('Adresse')).toHaveValue('/scene')
    expect(screen.getByLabelText('Wert')).toBeInTheDocument()
    expect(useOscInputRulesStore.getState().learning).toBe(false)
  })
})
