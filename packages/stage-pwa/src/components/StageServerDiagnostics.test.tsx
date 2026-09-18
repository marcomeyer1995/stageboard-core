import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { useDialogStore } = await import('../store/useDialogStore')
const { StageServerDiagnostics } = await import('./StageServerDiagnostics')
const { stageServerLog, setStageServerDebugEnabled, getStageServerLogLines } = await import('../lib/stageServerDebug')

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  useDialogStore.setState({ alert: vi.fn().mockResolvedValue(undefined) })
})

describe('StageServerDiagnostics', () => {
  it('is off by default: just the switch, no controls or log', () => {
    render(<StageServerDiagnostics reload={vi.fn()} />)

    expect(screen.getByLabelText(/Timing-Log/)).not.toBeChecked()
    expect(screen.queryByText('Neu messen')).not.toBeInTheDocument()
  })

  it('the switch turns recording on (persisted) and reveals the controls', () => {
    render(<StageServerDiagnostics reload={vi.fn()} />)

    fireEvent.click(screen.getByLabelText(/Timing-Log/))

    expect(localStorage.getItem('sb:debug:stageServer')).toBe('1')
    expect(screen.getByText('Neu messen')).toBeInTheDocument()
    expect(screen.getByText(/Noch keine Einträge/)).toBeInTheDocument()
  })

  it('shows recorded lines as they arrive', () => {
    setStageServerDebugEnabled(true)
    render(<StageServerDiagnostics reload={vi.fn()} />)

    act(() => stageServerLog('fetchServerInfo ok 4ms total blocked 1ms server 2ms'))

    expect(screen.getByText(/fetchServerInfo ok 4ms total/)).toBeInTheDocument()
  })

  it('"Neu messen" re-runs the status fetch', () => {
    setStageServerDebugEnabled(true)
    const reload = vi.fn().mockResolvedValue(undefined)
    render(<StageServerDiagnostics reload={reload} />)

    fireEvent.click(screen.getByText('Neu messen'))

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('"Leeren" empties the log', () => {
    setStageServerDebugEnabled(true)
    render(<StageServerDiagnostics reload={vi.fn()} />)
    act(() => stageServerLog('something'))

    fireEvent.click(screen.getByText('Leeren'))

    expect(getStageServerLogLines()).toEqual([])
    expect(screen.getByText(/Noch keine Einträge/)).toBeInTheDocument()
  })

  it('"Kopieren" puts the lines on the clipboard', async () => {
    setStageServerDebugEnabled(true)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<StageServerDiagnostics reload={vi.fn()} />)
    act(() => stageServerLog('reload start'))

    fireEvent.click(screen.getByText('Kopieren'))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('reload start')))
  })

  it('tells the user when copying is not possible instead of failing silently', async () => {
    setStageServerDebugEnabled(true)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true })
    const alert = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert })
    render(<StageServerDiagnostics reload={vi.fn()} />)
    act(() => stageServerLog('x'))

    fireEvent.click(screen.getByText('Kopieren'))

    await waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining('Kopieren nicht möglich')))
  })
})
