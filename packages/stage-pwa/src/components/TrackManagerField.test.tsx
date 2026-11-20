import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginInstallation, TrackMeta } from 'shared-types'

const db = vi.hoisted(() => ({ putAsyncJob: vi.fn(async () => {}), removeAsyncJob: vi.fn() }))
vi.mock('../lib/asyncJobsDb', () => db)
const variants = vi.hoisted(() => ({ putTrack: vi.fn(async () => {}), removeTrack: vi.fn(), updateStem: vi.fn(), getTrack: vi.fn() }))
vi.mock('../lib/songVariantsDb', () => variants)
const youtube = vi.hoisted(() => ({ searchYoutube: vi.fn(), youtubeThumbnailUrl: (id: string) => `https://server/youtube/thumbnail?id=${id}`, formatVideoLength: (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }))
vi.mock('../lib/youtubeSearch', () => youtube)
const addonMethods = vi.hoisted(() => ({ callAddonMethod: vi.fn() }))
vi.mock('../lib/addonMethodClient', () => addonMethods)
// The add-on's view script runs in a Worker on a device; here the same script runs in-process behind the same message interface.
vi.mock('../lib/addonUi/slotHost', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/addonUi/slotHost')>()
  const standIn: import('../lib/addonUi/slotHost').ViewWorkerFactory = (code) => {
    const worker = { onmessage: null as ((e: { data: unknown }) => void) | null, onerror: null, terminate: () => {}, postMessage: (m: unknown) => void queueMicrotask(() => scope.onmessage?.({ data: m })) }
    const scope: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: (m: unknown) => void } = { onmessage: null, postMessage: (m) => void queueMicrotask(() => worker.onmessage?.({ data: m })) }
    new Function('self', code)(scope)
    return worker
  }
  return { ...real, AddonSlot: (props: Parameters<typeof real.AddonSlot>[0]) => real.AddonSlot({ ...props, createWorker: standIn }) }
})
vi.mock('../lib/measureAudioDuration', () => ({ measureAudioDurationMs: vi.fn(async () => 180_000) }))
// The upload converts to Ogg Opus (#775) - here the file passes as it is (trackFile.test.ts tests the conversion).
vi.mock('../lib/engine/trackFile', () => ({ toTrackFile: vi.fn(async (f: Blob) => f), TRACK_MIME: 'audio/ogg; codecs=opus', NoEncoderError: class extends Error {} }))
// Where YouTube runs (useYoutubeRoute.ts): by default unknown - the host is asked, as before.
const route = vi.hoisted(() => ({ value: { route: null as 'server' | 'device' | 'none' | null, helper: null as unknown, trusted: [] as readonly string[] } }))
vi.mock('../lib/useYoutubeRoute', () => ({ useYoutubeRoute: () => route.value }))
const device = vi.hoisted(() => ({ searchOnDevice: vi.fn(), runOnDevice: vi.fn(async () => {}) }))
vi.mock('../lib/youtubeDevice', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/youtubeDevice')>()), ...device }))
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
  route.value = { route: null, helper: null, trusted: [] }
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

describe('TrackManagerField - YouTube search in "Track hinzufügen" (#618)', () => {
  const ytPlugin = { ...stemPlugin, id: 'youtube-download', name: 'YouTube-Download', capabilities: ['video-download'] } as unknown as PluginInstallation

  it('with a host: the add-on\'s own dialog (its view script, drawn by the editor) searches through the add-on\'s method, lists the hits, and a tap queues the generic audio-import job', async () => {
    usePluginsStore.setState({ installed: [ytPlugin] })
    route.value = { route: 'server', helper: null, trusted: [] }
    addonMethods.callAddonMethod.mockResolvedValueOnce({
      ok: true,
      body: { hits: [{ id: '9Ht5RZpzPqw', title: 'blink-182 - All The Small Things', channel: 'blink-182', durationSec: 171, url: 'https://www.youtube.com/watch?v=9Ht5RZpzPqw' }] },
    })
    render(<TrackManagerField variantId="v1" tracks={[]} disabled={false} searchQuery="All the small things Blink-182" />)
    fireEvent.click(screen.getByRole('button', { name: /Track hinzufügen/ }))
    // The entry the add-on declared for the slot; opening it runs its view script in a stand-in Worker.
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'YouTube' }))
    const youtubeDialog = await screen.findByRole('dialog', { name: 'Von YouTube laden' })
    expect(within(youtubeDialog).getByLabelText('Titel Band oder YouTube-Link')).toHaveValue('All the small things Blink-182')
    fireEvent.click(within(youtubeDialog).getByRole('button', { name: 'Suchen' }))
    await waitFor(() => expect(addonMethods.callAddonMethod).toHaveBeenCalledWith('youtube-download', 'search', { query: 'All the small things Blink-182' }))

    const hit = await within(youtubeDialog).findByText('blink-182 - All The Small Things')
    expect(within(youtubeDialog).getByText('blink-182 · 2:51')).toBeInTheDocument()
    fireEvent.click(hit)
    await waitFor(() =>
      expect(db.putAsyncJob).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'audio-import', variantId: 'v1', addonId: 'youtube-download', method: 'fetchAudio', args: { url: 'https://www.youtube.com/watch?v=9Ht5RZpzPqw' }, label: 'blink-182 - All The Small Things', status: 'queued' }),
      ),
    )
    // The progress is the job document's, not a message to the add-on.
    expect(await within(youtubeDialog).findByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('a pasted link is queued without a search - the add-on knows which links are its own; any other text is searched', async () => {
    usePluginsStore.setState({ installed: [ytPlugin] })
    route.value = { route: 'server', helper: null, trusted: [] }
    render(<TrackManagerField variantId="v1" tracks={[]} disabled={false} searchQuery="https://youtu.be/dQw4w9WgXcQ" />)
    fireEvent.click(screen.getByRole('button', { name: /Track hinzufügen/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'YouTube' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Suchen' }))
    await waitFor(() => expect(db.putAsyncJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'audio-import', args: { url: 'https://youtu.be/dQw4w9WgXcQ' }, label: 'YouTube Referenz' })))
    expect(addonMethods.callAddonMethod).not.toHaveBeenCalled()
  })

  it('shows the add-on\'s own words when its search fails (e.g. no host, no internet)', async () => {
    usePluginsStore.setState({ installed: [ytPlugin] })
    route.value = { route: 'server', helper: null, trusted: [] }
    addonMethods.callAddonMethod.mockResolvedValueOnce({ ok: false, error: { code: 'youtube.searchTimeout', message: 'Die YouTube-Suche hat nicht geantwortet - ist das Gerät online?' } })
    render(<TrackManagerField variantId="v1" tracks={[]} disabled={false} searchQuery="x" />)
    fireEvent.click(screen.getByRole('button', { name: /Track hinzufügen/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'YouTube' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Suchen' }))
    expect(await screen.findByText('Die YouTube-Suche hat nicht geantwortet - ist das Gerät online?')).toBeInTheDocument()
  })

  it('the editor refuses a method the add-on never declared - it never reaches a host', async () => {
    const { addonsForSlot } = await import('../lib/addonUi/builtinAddons')
    expect(addonsForSlot('song-editor.track-source', ['youtube-download']).map((e) => e.entry.title)).toEqual(['YouTube'])
    expect(addonsForSlot('song-editor.track-source', [])).toEqual([])
    expect(addonsForSlot('device.panel', ['youtube-download'])).toEqual([])
  })

  it('without a host that can, this device searches and downloads with its helper (docs/25 §6b)', async () => {
    usePluginsStore.setState({ installed: [ytPlugin] })
    const helper = { package: 'de.stageboard.helper.youtube', certSha256: 'c'.repeat(64), apiVersion: 1 }
    // The trust list travels with the route (useYoutubeRoute reads it from the installed manifest, #756).
    route.value = { route: 'device', helper, trusted: ['c'.repeat(64)] }
    device.searchOnDevice.mockResolvedValueOnce([{ id: '9Ht5RZpzPqw', title: 'blink-182 - All The Small Things', channel: 'blink-182', durationSec: 171, url: 'https://www.youtube.com/watch?v=9Ht5RZpzPqw' }])
    render(<TrackManagerField variantId="v1" tracks={[]} disabled={false} searchQuery="All the small things" />)
    fireEvent.click(screen.getByRole('button', { name: /Track hinzufügen/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suchen' }))
    expect(device.searchOnDevice).toHaveBeenCalledWith(helper, 'All the small things', ['c'.repeat(64)])
    expect(youtube.searchYoutube).not.toHaveBeenCalled()
    const hit = await within(dialog).findByRole('button', { name: /All The Small Things/ })
    // The picture straight from YouTube - the device has the internet when it searched itself.
    expect(hit.querySelector('img')?.getAttribute('src')).toBe('https://i.ytimg.com/vi/9Ht5RZpzPqw/mqdefault.jpg')
    fireEvent.click(hit)
    await waitFor(() => expect(device.runOnDevice).toHaveBeenCalled())
    // Its own job, created running: no Host picks it up.
    expect(db.putAsyncJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'youtube-extract', status: 'running', runner: expect.stringMatching(/^device:/), url: 'https://www.youtube.com/watch?v=9Ht5RZpzPqw' }))
  })

  it('says where YouTube is missing when neither the host nor this device can', async () => {
    usePluginsStore.setState({ installed: [ytPlugin] })
    route.value = { route: 'none', helper: null, trusted: [] }
    render(<TrackManagerField variantId="v1" tracks={[]} disabled={false} searchQuery="x" />)
    fireEvent.click(screen.getByRole('button', { name: /Track hinzufügen/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Suchen' }))
    expect(await screen.findByText(/kein yt-dlp.*Hilfsprogramm nicht installiert/)).toBeInTheDocument()
    expect(youtube.searchYoutube).not.toHaveBeenCalled()
  })

  it('"Erweitert": this device only - without its helper the message says so and how to change it (#822)', async () => {
    usePluginsStore.setState({ installed: [ytPlugin] })
    route.value = { route: 'none', helper: null, trusted: [] }
    render(<TrackManagerField variantId="v1" tracks={[]} disabled={false} searchQuery="x" />)
    fireEvent.click(screen.getByRole('button', { name: /Track hinzufügen/ }))
    fireEvent.click(screen.getByText('Erweitert'))
    fireEvent.click(screen.getByRole('radio', { name: 'Dieses Gerät' }))
    expect(localStorage.getItem('sb:youtube:where')).toBe('device')
    fireEvent.click(screen.getByRole('button', { name: 'Suchen' }))
    expect(await screen.findByText(/Auf diesem Gerät fehlt das YouTube-Hilfsprogramm/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Automatisch' }))
    expect(localStorage.getItem('sb:youtube:where')).toBeNull()
  })

  it('no search without the add-on', () => {
    render(<TrackManagerField variantId="v1" tracks={[]} disabled={false} searchQuery="x" />)
    fireEvent.click(screen.getByRole('button', { name: /Track hinzufügen/ }))
    expect(screen.queryByRole('searchbox', { name: 'YouTube durchsuchen' })).not.toBeInTheDocument()
  })
})
