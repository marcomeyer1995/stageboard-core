import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogicalDevice } from 'shared-types'
import { CueRecorder } from './CueRecorder'
import { analyzeOnsetsBlob } from '../lib/analyzeTrack'

const mocks = vi.hoisted(() => ({
  devices: [] as unknown[],
  configs: [] as unknown[],
  isPlaying: true,
  clockMs: 0,
  sendMidi: null as null | ((data: number[]) => void),
}))

// The stores underneath transitively build a real PouchDB at import time (unavailable under
// happy-dom), and WebMIDI/audio do not exist there at all - so all of it is mocked directly.
vi.mock('../store/useLogicalDevicesStore', () => ({
  useLogicalDevicesStore: (selector: (s: { devices: unknown[] }) => unknown) => selector({ devices: mocks.devices }),
}))
vi.mock('../store/useDeviceTransportConfigStore', () => ({
  useDeviceTransportConfigStore: (selector: (s: { configs: unknown[] }) => unknown) => selector({ configs: mocks.configs }),
}))
vi.mock('../store/useClockStore', () => ({ useClockStore: { getState: () => ({ getElapsedMs: () => mocks.clockMs }) } }))
vi.mock('../lib/deviceId', () => ({ getDeviceId: () => 'this-tablet' }))
vi.mock('../lib/useTrackClock', () => ({
  formatTrackClockTime: () => '00:00',
  useTrackClock: () => ({ elapsedMs: 0, isPlaying: mocks.isPlaying, duration: 0, position: 0, togglePlay: vi.fn(), audioProps: {} }),
}))
vi.mock('../lib/analyzeTrack', () => ({ analyzeOnsetsBlob: vi.fn() }))
vi.mock('../lib/webMidi', () => ({
  listMidiInputs: vi.fn().mockResolvedValue([{ id: 'in-1', name: 'RC-500 Port' }]),
  listenToMidiInputById: vi.fn(async (_id: string, onMessage: (data: number[]) => void) => {
    mocks.sendMidi = onMessage
    return () => {
      mocks.sendMidi = null
    }
  }),
}))

const rc500: LogicalDevice = { id: 'ld-rc500', name: 'Marcos RC-500', capability: 'rc500-control' } as LogicalDevice

async function pickDevice() {
  await screen.findByRole('option', { name: 'RC-500 Port' })
  fireEvent.change(screen.getByLabelText('Gerät'), { target: { value: 'ld-rc500' } })
  await waitFor(() => expect(mocks.sendMidi).not.toBeNull())
}

const receive = (data: number[]) => act(() => mocks.sendMidi?.(data))

describe('CueRecorder (#6)', () => {
  beforeEach(() => {
    Object.assign(mocks, { devices: [rc500], configs: [], isPlaying: true, clockMs: 0, sendMidi: null })
  })

  it('offers only devices that can be decoded and says so when there are none', () => {
    mocks.devices = [{ id: 'ld-cq', name: 'Pult', capability: 'cq18t-control' }]
    render(<CueRecorder trackSrc="blob:track" onComplete={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('Kein aufnahmefähiges Gerät eingerichtet')).toBeInTheDocument()
  })

  it('needs a track: without one it explains that cues need a timeline', () => {
    render(<CueRecorder trackSrc={null} onComplete={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText(/kein Track angehängt/)).toBeInTheDocument()
  })

  it('records what the device sends while the track plays, at the track position', async () => {
    const onComplete = vi.fn()
    render(<CueRecorder trackSrc="blob:track" onComplete={onComplete} onCancel={vi.fn()} />)
    await pickDevice()

    mocks.clockMs = 12_340
    receive([0xc0, 4]) // RC-500: memory 5
    mocks.clockMs = 47_000
    receive([0xc0, 9])

    expect(await screen.findByText(/rc500.selectMemory \(memory 5\)/)).toBeInTheDocument()
    expect(screen.getByText(/rc500.selectMemory \(memory 10\)/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Übernehmen/ }))
    const cues = onComplete.mock.calls[0][0]
    expect(cues).toHaveLength(2)
    expect(cues[0]).toMatchObject({ timeMs: 12_340, targetLogicalDeviceId: 'ld-rc500', type: 'rc500.selectMemory', payload: { memory: 5 } })
    expect(cues[1]).toMatchObject({ timeMs: 47_000, payload: { memory: 10 } })
  })

  it('ignores messages while the track is paused', async () => {
    mocks.isPlaying = false
    render(<CueRecorder trackSrc="blob:track" onComplete={vi.fn()} onCancel={vi.fn()} />)
    await pickDevice()

    receive([0xc0, 4])

    expect(screen.getByText('Noch nichts aufgenommen.')).toBeInTheDocument()
  })

  it('counts messages it could not turn into an event', async () => {
    render(<CueRecorder trackSrc="blob:track" onComplete={vi.fn()} onCancel={vi.fn()} />)
    await pickDevice()

    receive([0xf8])
    receive([0xb0, 20, 127])

    expect(await screen.findByText(/2 Nachricht\(en\) ohne passendes Ereignis übersprungen/)).toBeInTheDocument()
  })

  it('only reads the channel configured for the device', async () => {
    mocks.configs = [{ deviceId: 'this-tablet', logicalDeviceId: 'ld-rc500', values: { midiChannel: 3 } }]
    render(<CueRecorder trackSrc="blob:track" onComplete={vi.fn()} onCancel={vi.fn()} />)
    await pickDevice()

    receive([0xc0, 4]) // channel 1: not this device
    receive([0xc2, 5]) // channel 3

    expect(await screen.findByText(/memory 6/)).toBeInTheDocument()
    expect(screen.queryByText(/memory 5\)/)).not.toBeInTheDocument()
  })

  it('cannot accept before anything was recorded, and cancel leaves nothing behind', async () => {
    const onCancel = vi.fn()
    render(<CueRecorder trackSrc="blob:track" onComplete={vi.fn()} onCancel={onCancel} />)
    expect(screen.getByRole('button', { name: /Übernehmen/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(onCancel).toHaveBeenCalled()
  })

  describe('onset snapping (#7)', () => {
    const onsets = { onsets: [12_000, 30_000, 47_020].map((timeMs) => ({ timeMs, strength: 4 })), durationMs: 60_000 }

    async function analyze(props: { chordProContent?: string } = {}) {
      vi.mocked(analyzeOnsetsBlob).mockResolvedValue(onsets)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: () => Promise.resolve(new Blob(['x'])) }))
      const onComplete = vi.fn()
      render(<CueRecorder trackSrc="blob:track" onComplete={onComplete} onCancel={vi.fn()} {...props} />)
      await pickDevice()
      fireEvent.click(screen.getByRole('button', { name: 'Onsets analysieren' }))
      await screen.findByText('3 Onsets gefunden')
      return onComplete
    }

    it('snaps recorded cues onto the nearest onset when accepted, and shows the shift', async () => {
      const onComplete = await analyze()
      mocks.clockMs = 12_040
      receive([0xc0, 4]) // 40 ms after the onset at 12.0 s
      mocks.clockMs = 40_000
      receive([0xc0, 9]) // nothing within the window

      expect(await screen.findByText(/eingerastet -40 ms/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /Übernehmen/ }))
      const cues = onComplete.mock.calls[0][0]
      expect(cues[0].timeMs).toBe(12_000)
      expect(cues[1].timeMs).toBe(40_000) // out of range: untouched
    })

    it('keeps the recorded times when snapping is switched off', async () => {
      const onComplete = await analyze()
      fireEvent.click(screen.getByLabelText('Cues einrasten'))
      mocks.clockMs = 12_040
      receive([0xc0, 4])

      await screen.findByText(/rc500.selectMemory/)
      fireEvent.click(screen.getByRole('button', { name: /Übernehmen/ }))
      expect(onComplete.mock.calls[0][0][0].timeMs).toBe(12_040)
    })

    it('shows how far each timestamped section start is from its nearest onset', async () => {
      await analyze({ chordProContent: '{part: Verse 1}\n[00:12.00]la\n{part: Chorus}\n[00:47.00]la\n{part: Bridge}\n[01:20.00]la' })
      expect(screen.getByText(/Verse 1 · 12.0s · \+0 ms/)).toBeInTheDocument()
      expect(screen.getByText(/Chorus · 47.0s · \+20 ms/)).toBeInTheDocument()
      expect(screen.getByText(/Bridge · 80.0s · kein Onset innerhalb/)).toBeInTheDocument()
    })

    it('reports a failed analysis without touching the recording', async () => {
      vi.mocked(analyzeOnsetsBlob).mockRejectedValue(new Error('decode'))
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: () => Promise.resolve(new Blob(['x'])) }))
      render(<CueRecorder trackSrc="blob:track" onComplete={vi.fn()} onCancel={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: 'Onsets analysieren' }))
      expect(await screen.findByText(/Onset-Analyse fehlgeschlagen/)).toBeInTheDocument()
    })
  })
})
