import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupOverview } from 'shared-types'

// The workspace store imports workspaceDb.ts, which builds a PouchDB at load time.
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))
vi.mock('../lib/stageServer', () => ({ getStageServerUrl: () => 'https://server' }))
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { ServerBackupTargets } = await import('./ServerBackupTargets')

const overview: BackupOverview = {
  targets: [
    {
      target: { id: 'usb', name: 'USB-Stick', kind: 'folder', path: '/media/marco/STICK', keep: 7, dailyAt: '04:00', onPlugIn: true, enabled: true },
      status: { lastSuccessAt: null, lastRunAt: new Date().toISOString(), lastError: 'Ziel nicht da', lastBytes: null, running: false, present: false },
    },
    {
      target: { id: 'nas', name: 'NAS', kind: 'ssh', host: 'nas.local', user: 'backup', remotePath: '/volume1/sb', port: 22, keep: 7, dailyAt: '03:00', onPlugIn: false, enabled: true },
      status: { lastSuccessAt: new Date(Date.now() - 2 * 3600_000).toISOString(), lastRunAt: null, lastError: null, lastBytes: 2_500_000_000, running: false, present: null },
    },
  ],
  publicKey: 'ssh-ed25519 AAAA stageboard-backup',
}

let calls: Array<{ url: string; body: Record<string, unknown> }>

function admin(isAdmin: boolean) {
  useWorkspaceStore.setState({
    activeWorkspaceId: 'w1',
    workspaces: [{ id: 'w1', name: 'Band', username: 'marco', couchPassword: 'pw', isAdmin } as never],
  })
}

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> })
      return new Response(JSON.stringify(overview), { status: 200 })
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('ServerBackupTargets (#363)', () => {
  it('lists the targets with their state and the server key, asking with the admin login', async () => {
    admin(true)
    render(<ServerBackupTargets />)
    expect(await screen.findByText(/Fehlgeschlagen.*Ziel nicht da/)).toBeInTheDocument()
    expect(screen.getByText(/Medium nicht eingesteckt/)).toBeInTheDocument()
    expect(screen.getByText(/Letzte Sicherung vor 2 Std\., 2,5 GB/)).toBeInTheDocument()
    expect(screen.getByText('ssh-ed25519 AAAA stageboard-backup')).toBeInTheDocument()
    expect(calls[0]).toMatchObject({ url: 'https://server/server/backup/overview', body: { adminUsername: 'marco', adminPassword: 'pw' } })
  })

  it('a new NAS target can only be saved once host, user and folder are filled', async () => {
    admin(true)
    render(<ServerBackupTargets />)
    fireEvent.click(await screen.findByText('Ziel hinzufügen'))
    fireEvent.click(screen.getByText('NAS über Netzwerk'))
    const save = screen.getByRole('button', { name: 'Speichern' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Adresse der NAS'), { target: { value: 'nas.local' } })
    fireEvent.change(screen.getByLabelText('Benutzer'), { target: { value: 'backup' } })
    fireEvent.change(screen.getByLabelText('Ordner auf der NAS'), { target: { value: '/volume1/sb' } })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/backup/save'))).toBe(true))
    expect(calls.find((c) => c.url.endsWith('/backup/save'))!.body.target).toMatchObject({ kind: 'ssh', host: 'nas.local', dailyAt: '04:00' })
  })

  it('shows nothing to a member who is not admin', () => {
    admin(false)
    const { container } = render(<ServerBackupTargets />)
    expect(container).toBeEmptyDOMElement()
  })
})
