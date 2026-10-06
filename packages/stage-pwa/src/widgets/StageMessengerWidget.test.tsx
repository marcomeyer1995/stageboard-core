import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/useActiveProfile', () => ({ useActiveProfile: () => ({ name: 'Marco' }) }))
vi.mock('../lib/stageServer', () => ({ getStageServerUrl: () => 'https://stage' }))
vi.mock('../store/useWorkspaceStore', () => ({ useWorkspaceStore: (select: (s: object) => unknown) => select({ activeWorkspaceId: 'band-a', workspaces: [{ id: 'band-a', username: 'stageboard-band-a-p1~d1', couchPassword: 'secret' }] }) }))

vi.mock('../store/useProfilesStore', () => ({
  useProfilesStore: (select: (s: object) => unknown) => select({ profiles: [{ id: 'p1', name: 'Marco' }, { id: 'p2', name: 'Caro' }, { id: 'p3', name: 'Kapper' }] }),
}))

const { StageMessengerWidget, StageMessengerConfigPanel } = await import('./StageMessengerWidget')

describe('StageMessengerWidget (#26)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('a preset tap sends it to the band with the sender name', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    render(<StageMessengerWidget config={{}} />)
    fireEvent.click(screen.getByRole('button', { name: 'VAMP' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('An alle gesendet: „VAMP“'))
    expect(fetchMock.mock.calls[0][0]).toBe('https://stage/workspaces/band-a/flash')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ text: 'VAMP', from: 'Marco' })
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Basic ${btoa('stageboard-band-a-p1~d1:secret')}`)
  })

  it('"An": only to the picked musicians, "Alle" back to everyone', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    render(<StageMessengerWidget config={{}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Caro' }))
    expect(screen.getByRole('button', { name: 'Alle' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Gitarre stimmen' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('An Caro gesendet'))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ text: 'Gitarre stimmen', from: 'Marco', to: ['p2'] })
    fireEvent.click(screen.getByRole('button', { name: 'Alle' }))
    fireEvent.click(screen.getByRole('button', { name: 'VAMP' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ text: 'VAMP', from: 'Marco' })
  })

  it("shows this widget's own quick messages, in their order", () => {
    render(<StageMessengerWidget config={{ presets: ['Bridge doppelt', 'Ende!'] }} />)
    expect(screen.getByRole('button', { name: 'Bridge doppelt' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'VAMP' })).not.toBeInTheDocument()
  })

  it('settings: change, reorder, remove, add, back to the standard list', () => {
    const onChange = vi.fn()
    const { rerender } = render(<StageMessengerConfigPanel config={{ presets: ['A', 'B', 'C'] }} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '„C“ nach oben' }))
    expect(onChange).toHaveBeenLastCalledWith({ presets: ['A', 'C', 'B'] })
    fireEvent.click(screen.getByRole('button', { name: '„A“ entfernen' }))
    expect(onChange).toHaveBeenLastCalledWith({ presets: ['B', 'C'] })
    fireEvent.change(screen.getByLabelText('Nachricht 2'), { target: { value: 'Bee' } })
    expect(onChange).toHaveBeenLastCalledWith({ presets: ['A', 'Bee', 'C'] })
    fireEvent.click(screen.getByRole('button', { name: '+ Nachricht' }))
    expect(onChange).toHaveBeenLastCalledWith({ presets: ['A', 'B', 'C', 'Neue Nachricht'] })
    fireEvent.click(screen.getByRole('button', { name: 'Standard wiederherstellen' }))
    expect(onChange).toHaveBeenLastCalledWith({ presets: undefined })
    rerender(<StageMessengerConfigPanel config={{}} onChange={onChange} />)
    expect(screen.queryByRole('button', { name: 'Standard wiederherstellen' })).not.toBeInTheDocument()
  })

  it('says so when the server does not accept this device for the band', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    render(<StageMessengerWidget config={{}} />)
    fireEvent.click(screen.getByRole('button', { name: 'VAMP' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('nicht bei der Band angemeldet'))
  })

  it('sends a typed message and reports a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    render(<StageMessengerWidget config={{}} />)
    fireEvent.change(screen.getByLabelText('Nachricht an alle'), { target: { value: 'Bridge doppelt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Nicht gesendet'))
  })
})
