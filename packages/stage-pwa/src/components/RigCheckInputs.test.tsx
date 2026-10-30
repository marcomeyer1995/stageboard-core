import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({ default: class {} }))
vi.mock('../lib/stageServer', () => ({ getStageServerUrl: () => 'https://server' }))

const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { RigCheckInputs } = await import('./RigCheckInputs')

const calls: { path: string; body: Record<string, unknown> }[] = []

beforeEach(() => {
  calls.length = 0
  useWorkspaceStore.setState({ workspaces: [{ id: 'w', name: 'Band', isAdmin: true, username: 'band-marco', couchPassword: 'pw' }] as never, activeWorkspaceId: 'w' })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      const path = url.split('/').pop()!
      const body = JSON.parse(init.body) as Record<string, unknown>
      calls.push({ path, body })
      const answer =
        path === 'overview'
          ? { inputs: [{ device: 'plughw:CARD=U192k,DEV=0', name: 'UMC204HD', channels: 2 }], selected: { mic: null, cable: null }, fallbackMic: 'default' }
          : path === 'level'
            ? { peakDb: -12.5, clicks: 1, error: null }
            : { status: 'ok' }
      return new Response(JSON.stringify(answer), { status: 200 })
    }),
  )
})

describe('RigCheckInputs (#662)', () => {
  it('an admin picks the cable input and channel 2, saved on the server; the level says what arrived', async () => {
    render(<RigCheckInputs />)
    const cable = await screen.findAllByLabelText('Gerät')
    await act(async () => {
      fireEvent.change(cable[1]!, { target: { value: 'plughw:CARD=U192k,DEV=0' } })
    })
    expect(calls[calls.length - 1]).toMatchObject({ path: 'save', body: { adminUsername: 'band-marco', selected: { mic: null, cable: { device: 'plughw:CARD=U192k,DEV=0', channel: 0 } } } })
    await act(async () => {
      fireEvent.change(screen.getAllByLabelText('Kanal')[1]!, { target: { value: '1' } })
    })
    expect(calls[calls.length - 1]?.body.selected).toEqual({ mic: null, cable: { device: 'plughw:CARD=U192k,DEV=0', channel: 1 } })

    fireEvent.click(screen.getAllByRole('button', { name: 'Pegel prüfen' })[1]!)
    await waitFor(() => expect(screen.getByText('Pegel -12.5 dB · 1 Klick gehört')).toBeInTheDocument())
    expect(calls[calls.length - 1]).toMatchObject({ path: 'level', body: { input: { device: 'plughw:CARD=U192k,DEV=0', channel: 1 } } })
  })

  it('a member who is no admin only reads that admins set it', () => {
    useWorkspaceStore.setState({ workspaces: [{ id: 'w', name: 'Band', isAdmin: false }] as never, activeWorkspaceId: 'w' })
    render(<RigCheckInputs />)
    expect(screen.getByText('Nur Band-Admins können die Messeingänge ändern.')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })
})
