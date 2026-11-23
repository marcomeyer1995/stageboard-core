import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginInstallation, TrackMeta } from 'shared-types'
import { useHostUrlStore } from '../store/useHostUrlStore'

const db = vi.hoisted(() => ({ putAsyncJob: vi.fn(async () => {}), removeAsyncJob: vi.fn(async () => {}) }))
vi.mock('../lib/asyncJobsDb', () => db)
const variants = vi.hoisted(() => ({ putTrack: vi.fn(async () => {}), removeTrack: vi.fn(), updateStem: vi.fn(), getTrack: vi.fn() }))
vi.mock('../lib/songVariantsDb', () => variants)
const addonMethods = vi.hoisted(() => ({ callAddonMethod: vi.fn() }))
// Which host (if any) can run the add-on's methods, and what this device could do itself (docs/36 §2).
const hostFor = vi.hoisted(() => ({ value: { base: 'https://host' } as { base: string } | { base: null; message: string } }))
// The same order as the real choice (executorChoice.ts): this device first when it can, else the host there is, else what is missing.
vi.mock('../lib/jobHost', () => ({
  resolveHostFor: async () => hostFor.value,
  resolveExecutorFor: async (_addon: string, _load: string, self: { canRun: boolean }) =>
    self.canRun ? { where: 'self' } : hostFor.value.base !== null ? { where: 'host', url: hostFor.value.base } : { where: 'none', needs: null, note: hostFor.value.message },
}))
const local = vi.hoisted(() => ({ canRun: vi.fn(async () => false), call: vi.fn() }))
vi.mock('../lib/addonWork', () => ({ localAddonMethods: local }))
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
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { usePluginsStore } = await import('../store/usePluginsStore')
const { TrackManagerField, DONE_JOB_VISIBLE_MS } = await import('./TrackManagerField')
const { useAsyncJobsStore } = await import('../store/useAsyncJobsStore')

const track = (id: string, label: string, extra: Partial<TrackMeta> = {}): TrackMeta => ({ id, kind: 'band-mix', label, source: 'upload', parentTrackId: null, mimeType: 'audio/webm', addedAt: 0, ...extra })
const tracks = [track('mix', 'Band-Playback'), track('drums', 'Schlagzeug', { kind: 'stem', parentTrackId: 'mix', source: 'stem-separation' })]
const stemPlugin = { id: 'stem-separation', name: 'Spuren trennen', version: '0.0.1', enabled: true, runtime: 'host', installedAt: 0, capabilities: ['stem-separation'], transports: [], hardwareIds: [] } as unknown as PluginInstallation

beforeEach(() => {
  vi.clearAllMocks()
  usePluginsStore.setState({ installed: [] })
  hostFor.value = { base: 'https://host' }
  local.canRun.mockResolvedValue(false)
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

  it("the stem add-on's own dialog queues a job with the chosen stems - guitar split only in the extended set", async () => {
    usePluginsStore.setState({ installed: [stemPlugin] })
    render(<TrackManagerField variantId="v1" tracks={tracks} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Spuren trennen' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(/bisherigen Spuren dieses Tracks werden ersetzt/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Erweitert' }))
    fireEvent.click(await within(dialog).findByRole('switch', { name: /Zwei Gitarren trennen/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Trennen' }))
    await waitFor(() => expect(db.putAsyncJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'stem-separation', variantId: 'v1', sourceTrackId: 'mix', model: 'extended', splitGuitar: true, status: 'queued' })))
    // The add-on closes its own dialog once the job is queued.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
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

describe('TrackManagerField - finished jobs clear themselves', () => {
  const job = (id: string, status: 'done' | 'error' | 'running') => ({ id, type: 'audio-import' as const, status, progress: 1, createdAt: 1, updatedAt: 1, variantId: 'v1', addonId: 'a', method: 'm', args: {}, label: 'x', ...(status === 'error' ? { error: 'kaputt' } : {}) })

  it('a done job\'s line goes after a few seconds; a failed one and a running one stay', () => {
    vi.useFakeTimers()
    try {
      useAsyncJobsStore.setState({ jobs: [job('ok', 'done'), job('bad', 'error'), job('busy', 'running')] })
      render(<TrackManagerField variantId="v1" tracks={[]} disabled={false} />)
      expect(db.removeAsyncJob).not.toHaveBeenCalled()
      vi.advanceTimersByTime(DONE_JOB_VISIBLE_MS - 1)
      expect(db.removeAsyncJob).not.toHaveBeenCalled()
      vi.advanceTimersByTime(2)
      expect(db.removeAsyncJob).toHaveBeenCalledTimes(1)
      expect(db.removeAsyncJob).toHaveBeenCalledWith('ok')
      expect(screen.getByText(/kaputt/)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
      useAsyncJobsStore.setState({ jobs: [] })
    }
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
    addonMethods.callAddonMethod.mockResolvedValueOnce({
      ok: true,
      body: { hits: [{ id: '9Ht5RZpzPqw', title: 'blink-182 - All The Small Things', channel: 'blink-182', durationSec: 171, url: 'https://www.youtube.com/watch?v=9Ht5RZpzPqw' }] },
    })
    render(<TrackManagerField variantId="v1" tracks={[]} disabled={false} searchQuery="All the small things Blink-182" />)
    fireEvent.click(screen.getByRole('button', { name: /Track hinzufügen/ }))
    // The entry the add-on declared for the slot; opening it runs its view script in a stand-in Worker.
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'YouTube' }))
    const youtubeDialog = await screen.findByRole('dialog')
    expect(await within(youtubeDialog).findByLabelText('Titel Band oder YouTube-Link')).toHaveValue('All the small things Blink-182')
    fireEvent.click(within(youtubeDialog).getByRole('button', { name: 'Suchen' }))
    await waitFor(() => expect(addonMethods.callAddonMethod).toHaveBeenCalledWith('youtube-download', 'search', { query: 'All the small things Blink-182' }))

    const hit = await within(youtubeDialog).findByText('blink-182 - All The Small Things')
    expect(within(youtubeDialog).getByText('blink-182 · 2:51')).toBeInTheDocument()
    // To listen in before choosing: a link out to the video, drawn from the add-on's description - and it does not pick the hit.
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    fireEvent.click(within(youtubeDialog).getByRole('button', { name: 'Ansehen' }))
    expect(open).toHaveBeenCalledWith('https://www.youtube.com/watch?v=9Ht5RZpzPqw', '_blank', 'noopener,noreferrer')
    expect(db.putAsyncJob).not.toHaveBeenCalled()
    open.mockRestore()
    fireEvent.click(hit)
    await waitFor(() =>
      expect(db.putAsyncJob).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'audio-import', variantId: 'v1', addonId: 'youtube-download', method: 'fetchAudio', args: { url: 'https://www.youtube.com/watch?v=9Ht5RZpzPqw' }, label: 'blink-182 - All The Small Things', status: 'queued' }),
      ),
    )
    // The progress is the job document's, not a message to the add-on.
    expect(await within(youtubeDialog).findByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('with no host that can, this device runs the job itself when it has the add-on\'s helper: a running job of its own, the track put by this device', async () => {
    usePluginsStore.setState({ installed: [ytPlugin] })
    hostFor.value = { base: null, message: 'Missing: yt-dlp.' }
    local.canRun.mockResolvedValue(true)
    local.call.mockResolvedValue({ ok: false, error: { code: 'youtube.noAudio', message: 'YouTube bietet zu diesem Video keine ladbare Audiospur an.' } })
    render(<TrackManagerField variantId="v1" tracks={[]} disabled={false} searchQuery="https://youtu.be/dQw4w9WgXcQ" />)
    fireEvent.click(screen.getByRole('button', { name: /Track hinzufügen/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'YouTube' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Suchen' }))
    await waitFor(() => expect(local.call).toHaveBeenCalledWith('youtube-download', 'fetchAudio', { url: 'https://youtu.be/dQw4w9WgXcQ' }, expect.anything()))
    // The job is this device's own (running, runner device:...), never queued for a host; the add-on's words end it.
    expect(db.putAsyncJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'audio-import', status: 'running', runner: expect.stringMatching(/^device:/) }))
    await waitFor(() => expect(db.putAsyncJob).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', error: 'YouTube bietet zu diesem Video keine ladbare Audiospur an.' })))
  })

  it('this device first: with the add-on\'s helper here it runs the job itself even though a host could do it (#964)', async () => {
    usePluginsStore.setState({ installed: [ytPlugin] })
    hostFor.value = { base: 'https://host' }
    local.canRun.mockResolvedValue(true)
    local.call.mockResolvedValue({ ok: true, body: { audio: 'x' } })
    render(<TrackManagerField variantId="v1" tracks={[]} disabled={false} searchQuery="https://youtu.be/dQw4w9WgXcQ" />)
    fireEvent.click(screen.getByRole('button', { name: /Track hinzufügen/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'YouTube' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Suchen' }))
    await waitFor(() => expect(local.call).toHaveBeenCalledWith('youtube-download', 'fetchAudio', { url: 'https://youtu.be/dQw4w9WgXcQ' }, expect.anything()))
    expect(db.putAsyncJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'audio-import', runner: expect.stringMatching(/^device:/) }))
    expect(db.putAsyncJob).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'queued' }))
  })

  it('with no host and no helper on this device the person is told what is missing - no job is created', async () => {
    usePluginsStore.setState({ installed: [ytPlugin] })
    hostFor.value = { base: null, message: 'Missing: yt-dlp.' }
    // A host is set (as on a developer machine's .env): the message is about what it lacks, not "no host" - without it CI, with no .env, said the other thing.
    useHostUrlStore.setState({ url: 'https://host' })
    render(<TrackManagerField variantId="v1" tracks={[]} disabled={false} searchQuery="https://youtu.be/dQw4w9WgXcQ" />)
    fireEvent.click(screen.getByRole('button', { name: /Track hinzufügen/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'YouTube' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Suchen' }))
    expect(await screen.findByText('Missing: yt-dlp.')).toBeInTheDocument()
    expect(db.putAsyncJob).not.toHaveBeenCalled()
  })

  it('a pasted link is queued without a search - the add-on knows which links are its own; any other text is searched', async () => {
    usePluginsStore.setState({ installed: [ytPlugin] })
    render(<TrackManagerField variantId="v1" tracks={[]} disabled={false} searchQuery="https://youtu.be/dQw4w9WgXcQ" />)
    fireEvent.click(screen.getByRole('button', { name: /Track hinzufügen/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'YouTube' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Suchen' }))
    await waitFor(() => expect(db.putAsyncJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'audio-import', args: { url: 'https://youtu.be/dQw4w9WgXcQ' }, label: 'YouTube Referenz' })))
    expect(addonMethods.callAddonMethod).not.toHaveBeenCalled()
  })

  it('shows the add-on\'s own words when its search fails (e.g. no host, no internet)', async () => {
    usePluginsStore.setState({ installed: [ytPlugin] })
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

  it('no YouTube entry without the add-on installed', () => {
    render(<TrackManagerField variantId="v1" tracks={[]} disabled={false} searchQuery="x" />)
    fireEvent.click(screen.getByRole('button', { name: /Track hinzufügen/ }))
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'YouTube' })).not.toBeInTheDocument()
  })
})

describe('what a view script may put in a job (#964, review)', () => {
  it('only a short label and small arguments as an object - the job document replicates to every device', async () => {
    const { queueRequestProblem, MAX_JOB_ARGS_CHARS, MAX_JOB_LABEL_CHARS } = await import('./AddonSourceDialog')
    expect(queueRequestProblem({ label: 'Wonderwall', args: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } })).toBeNull()
    for (const [body, why] of [
      [null, 'no body'], ['x', 'a string'], [{ args: {} }, 'no label'], [{ label: '   ', args: {} }, 'blank label'], [{ label: 'x'.repeat(MAX_JOB_LABEL_CHARS + 1), args: {} }, 'long label'],
      [{ label: 'x' }, 'no args'], [{ label: 'x', args: 'url' }, 'args as string'], [{ label: 'x', args: ['a'] }, 'args as array'], [{ label: 'x', args: { blob: 'y'.repeat(MAX_JOB_ARGS_CHARS) } }, 'huge args'],
    ] as const) expect(queueRequestProblem(body), why).toEqual(expect.any(String))
  })
})
