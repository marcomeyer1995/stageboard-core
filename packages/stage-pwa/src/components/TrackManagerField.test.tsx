import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginInstallation, TrackMeta } from 'shared-types'

const db = vi.hoisted(() => ({ putAsyncJob: vi.fn(async () => {}), removeAsyncJob: vi.fn() }))
vi.mock('../lib/asyncJobsDb', () => db)
const variants = vi.hoisted(() => ({ putTrack: vi.fn(async () => {}), removeTrack: vi.fn(), updateStem: vi.fn(), getTrack: vi.fn() }))
vi.mock('../lib/songVariantsDb', () => variants)
vi.mock('../lib/measureAudioDuration', () => ({ measureAudioDurationMs: vi.fn(async () => 180_000) }))
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

describe('TrackManagerField - stem sets (docs/22)', () => {
  it('uploads several stems at once, named and with a role from the file name', async () => {
    render(<TrackManagerField variantId="v1" tracks={[]} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Track hinzufügen/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Art' }), { target: { value: 'stem' } })
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.multiple).toBe(true)
    const files = [new File(['k'], '01_Hammond.wav', { type: 'audio/wav' }), new File(['b'], 'Bass.wav', { type: 'audio/wav' }), new File(['x'], 'Didgeridoo.wav', { type: 'audio/wav' })]
    fireEvent.change(input, { target: { files } })
    await waitFor(() => expect(variants.putTrack).toHaveBeenCalledTimes(3))
    const metas = variants.putTrack.mock.calls.map((call) => (call as unknown[])[1] as TrackMeta)
    expect(metas.map((m) => [m.kind, m.label, m.role, m.parentTrackId])).toEqual([
      ['stem', 'Hammond', 'keys', null],
      ['stem', 'Bass', 'bass', null],
      ['stem', 'Didgeridoo', undefined, null],
    ])
  })

  it('lists uploaded stems in a set of their own and warns about different lengths', () => {
    const uploaded = [track('keys', 'Hammond', { kind: 'stem', role: 'keys', durationMs: 180_000 }), track('choir', 'Chor hoch', { kind: 'stem', durationMs: 175_000 })]
    render(<TrackManagerField variantId="v1" tracks={[...tracks, ...uploaded]} disabled={false} />)
    expect(screen.getByText('Hochgeladene Spuren')).toBeInTheDocument()
    expect(screen.getByText('Hammond')).toBeInTheDocument()
    expect(screen.getByText('Chor hoch')).toBeInTheDocument()
    expect(screen.getByText(/unterschiedlich lang/)).toBeInTheDocument()
  })
})

describe('TrackManagerField - one row per track (#604)', () => {
  it('play, edit and delete are icons; removing asks first', async () => {
    const { useDialogStore } = await import('../store/useDialogStore')
    const confirm = vi.fn(async () => true)
    useDialogStore.setState({ confirm })
    render(<TrackManagerField variantId="v1" tracks={tracks} disabled={false} />)
    expect(screen.getByRole('button', { name: 'Band-Playback anhören' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Schlagzeug anhören' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Schlagzeug bearbeiten' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Schlagzeug entfernen' }))
    await waitFor(() => expect(variants.removeTrack).toHaveBeenCalledWith('v1', 'drums'))
    expect(confirm).toHaveBeenCalledWith('„Schlagzeug“ entfernen?', expect.objectContaining({ danger: true }))
  })

  it('keeps the track when the question is declined', async () => {
    const { useDialogStore } = await import('../store/useDialogStore')
    useDialogStore.setState({ confirm: vi.fn(async () => false) })
    render(<TrackManagerField variantId="v1" tracks={tracks} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Band-Playback entfernen' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(variants.removeTrack).not.toHaveBeenCalled()
  })
})
