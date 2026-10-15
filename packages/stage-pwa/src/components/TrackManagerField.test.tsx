import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginInstallation, TrackMeta } from 'shared-types'

const db = vi.hoisted(() => ({ putAsyncJob: vi.fn(async () => {}), removeAsyncJob: vi.fn() }))
vi.mock('../lib/asyncJobsDb', () => db)
vi.mock('../lib/songVariantsDb', () => ({ putTrack: vi.fn(), removeTrack: vi.fn(), renameTrack: vi.fn(), getTrack: vi.fn() }))
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { usePluginsStore } = await import('../store/usePluginsStore')
const { TrackManagerField } = await import('./TrackManagerField')

const track = (id: string, label: string, extra: Partial<TrackMeta> = {}): TrackMeta => ({ id, kind: 'band-mix', label, source: 'upload', parentTrackId: null, mimeType: 'audio/webm', addedAt: 0, ...extra })
const tracks = [track('mix', 'Band-Playback'), track('drums', 'Schlagzeug', { kind: 'stem', parentTrackId: 'mix', source: 'stem-separation' })]
const stemPlugin = { id: 'stem-separation', name: 'Spuren trennen', version: '0.0.1', enabled: true, runtime: 'server', installedAt: 0, capabilities: ['stem-separation'], transports: [], hardwareIds: [] } as unknown as PluginInstallation

beforeEach(() => {
  vi.clearAllMocks()
  usePluginsStore.setState({ installed: [] })
})

describe('TrackManagerField - stems (#9)', () => {
  it('lists stems under their track; "Spuren trennen" only with the plugin installed', () => {
    const { unmount } = render(<TrackManagerField variantId="v1" tracks={tracks} disabled={false} />)
    expect(screen.getByText('Schlagzeug')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Spuren trennen' })).not.toBeInTheDocument()
    unmount()
    usePluginsStore.setState({ installed: [stemPlugin] })
    render(<TrackManagerField variantId="v1" tracks={tracks} disabled={false} />)
    expect(screen.getAllByRole('button', { name: 'Spuren trennen' })).toHaveLength(1) // the track, not its stem
  })

  it('queues a job with the chosen stems - guitar split only in the extended set', () => {
    usePluginsStore.setState({ installed: [stemPlugin] })
    render(<TrackManagerField variantId="v1" tracks={tracks} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Spuren trennen' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/bisherigen Spuren dieses Tracks werden ersetzt/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Erweitert' }))
    fireEvent.click(within(dialog).getByRole('switch', { name: /Gitarre links\/rechts/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Trennen' }))
    expect(db.putAsyncJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'stem-separation', variantId: 'v1', sourceTrackId: 'mix', model: 'extended', splitGuitar: true, status: 'queued' }))
  })
})
