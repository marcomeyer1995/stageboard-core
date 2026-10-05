import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/useActiveProfile', () => ({ useActiveProfile: () => ({ name: 'Marco' }) }))
vi.mock('../lib/stageServer', () => ({ getStageServerUrl: () => 'https://stage' }))
vi.mock('../store/useWorkspaceStore', () => ({ useWorkspaceStore: (select: (s: object) => unknown) => select({ activeWorkspaceId: 'band-a', workspaces: [{ id: 'band-a', username: 'stageboard-band-a-p1~d1', couchPassword: 'secret' }] }) }))

const { StageMessengerWidget } = await import('./StageMessengerWidget')

describe('StageMessengerWidget (#26)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('a preset tap sends it to the band with the sender name', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    render(<StageMessengerWidget config={{}} />)
    fireEvent.click(screen.getByRole('button', { name: 'VAMP' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Gesendet: „VAMP“'))
    expect(fetchMock.mock.calls[0][0]).toBe('https://stage/workspaces/band-a/flash')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ text: 'VAMP', from: 'Marco' })
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Basic ${btoa('stageboard-band-a-p1~d1:secret')}`)
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
