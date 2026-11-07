import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'

const install = vi.fn().mockResolvedValue(undefined)
vi.mock('../store/usePluginsStore', async () => {
  const { create } = await import('zustand')
  return { usePluginsStore: create(() => ({ installed: [{ id: 'youtube-download' }], install, uninstall: vi.fn() })) }
})
const caps = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('../lib/fetchHostCapabilities', () => ({ fetchHostCapabilities: async () => caps.current }))

const { HostPlugins } = await import('./HostPlugins')

beforeEach(() => install.mockClear())

describe('HostPlugins (docs/25 §6, 2026-11-07)', () => {
  it('installable where the host can run it, greyed with what it lacks where not, installed marked', async () => {
    caps.current = {
      kind: 'stage-server',
      platform: 'linux',
      arch: 'x64',
      database: 'builtin',
      plugins: [
        { id: 'stem-separation', available: false, needs: 'demucs' },
        { id: 'osc', available: true, needs: null },
        { id: 'youtube-download', available: true, needs: null },
      ],
    }
    render(<HostPlugins canInstall />)
    expect(await screen.findByText('läuft auf diesem Host nicht - braucht demucs')).toBeInTheDocument()
    expect(screen.getByText('installiert')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: 'Installieren' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0]!)
    expect(install).toHaveBeenCalledWith(expect.objectContaining({ id: 'osc', enabled: true }))
  })

  it('an older server that says nothing: a note instead of a list', async () => {
    caps.current = null
    render(<HostPlugins canInstall />)
    expect(await screen.findByText('Dieser Stage-Server meldet noch nicht, was er ausführen kann (ältere Version).')).toBeInTheDocument()
  })
})
