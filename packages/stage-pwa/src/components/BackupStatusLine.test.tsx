import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/stageServer', () => ({ getStageServerUrl: () => 'https://server' }))
const { BackupStatusLine } = await import('./BackupStatusLine')

function answer(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BackupStatusLine (#363)', () => {
  it('says when backups were never set up', async () => {
    answer(null)
    render(<BackupStatusLine />)
    expect(await screen.findByText(/noch nicht eingerichtet/)).toBeInTheDocument()
  })

  it('shows a recent successful backup', async () => {
    answer({ ok: true, at: new Date(Date.now() - 3 * 3600_000).toISOString() })
    render(<BackupStatusLine />)
    expect(await screen.findByText(/Letztes Backup vor 3 Std\./)).toBeInTheDocument()
  })

  it('warns when the last backup is older than two days', async () => {
    answer({ ok: true, at: new Date(Date.now() - 5 * 24 * 3600_000).toISOString() })
    render(<BackupStatusLine />)
    expect(await screen.findByText(/älter als zwei Tage/)).toBeInTheDocument()
  })

  it('shows the reason of a failed backup', async () => {
    answer({ ok: false, at: new Date().toISOString(), error: 'Ziel nicht da (nicht eingesteckt oder nicht eingehängt): /media/usb' })
    render(<BackupStatusLine />)
    expect(await screen.findByText(/Backup fehlgeschlagen.*nicht eingesteckt/)).toBeInTheDocument()
  })
})
