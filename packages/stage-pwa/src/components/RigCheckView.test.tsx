import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShowLogEvent } from 'shared-types'

// The stores open PouchDB at import time - unavailable under happy-dom.
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    async get() {
      throw Object.assign(new Error('missing'), { status: 404 })
    }
    async put() {
      return { ok: true }
    }
    async allDocs() {
      return { rows: [] }
    }
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))

const { getDeviceId } = await import('../lib/deviceId')
const { getServerTime } = await import('../lib/clockSync')
const { useBandSettingsStore } = await import('../store/useBandSettingsStore')
const { useLogicalDevicesStore } = await import('../store/useLogicalDevicesStore')
const { useShowLogStore } = await import('../store/useShowLogStore')
const { useShowStateStore } = await import('../store/useShowStateStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { RigCheckView } = await import('./RigCheckView')
const { RigCheckVerdict } = await import('./RigCheckVerdict')

const save = vi.fn(async () => {})
const append = vi.fn(async (event: ShowLogEvent) => {
  useShowLogStore.setState({ events: [...useShowLogStore.getState().events.filter((e) => e.id !== event.id), event] })
})

function report(overrides: Partial<Extract<ShowLogEvent, { type: 'rig-check-device' }>> = {}): ShowLogEvent {
  return {
    id: `rig-check-device-r1-${overrides.deviceId ?? 'fire'}`,
    showId: 'r1',
    type: 'rig-check-device',
    at: 1,
    deviceId: 'fire',
    deviceName: 'Fire',
    mode: 'gig',
    trackReady: true,
    clockOffsetMs: -12,
    clockJitterMs: 1.5,
    audioRoute: 'bluetooth',
    outputLatencyMs: 230,
    verdict: null,
    ...overrides,
  }
}

beforeEach(() => {
  save.mockClear()
  append.mockClear()
  useWorkspaceStore.setState({ workspaces: [{ id: 'band', name: 'Band', isAdmin: true }], activeWorkspaceId: 'band' } as never)
  useShowStateStore.setState({ isMaster: true })
  useBandSettingsStore.setState({ settings: { id: 'band' }, save })
  useLogicalDevicesStore.setState({ devices: [{ id: 'k', name: 'Kemper', capability: 'kemper-control', pluginId: 'kemper-profiler', executionTarget: null }] } as never)
  useShowLogStore.setState({ events: [], append })
})

describe('RigCheckView (#464)', () => {
  it('offers quick and full run, a cue per device with ready-made commands, and Vorbereiten on the master', () => {
    render(<RigCheckView />)
    expect(screen.getByRole('radio', { name: 'Kurzcheck' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/8 Takte 120, ein Sprung, 4 Takte 140/)).toBeInTheDocument()
    expect(screen.getByText('Kemper')).toBeInTheDocument()
    expect(screen.getByText('nichts - bleibt unberührt')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vorbereiten' })).toBeEnabled()
  })

  it('describes the chosen command; Entfernen takes it out band-wide', () => {
    useBandSettingsStore.setState({ settings: { id: 'band', rigCheckCues: [{ targetLogicalDeviceId: 'k', type: 'kemper.tuner', payload: {} }] } })
    render(<RigCheckView />)
    expect(screen.getByText(/Tuner an/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }))
    expect(save).toHaveBeenCalledWith({ id: 'band', rigCheckCues: [] })
  })

  it('a non-admin sees the cues but cannot change them; a non-master cannot prepare', () => {
    useWorkspaceStore.setState({ workspaces: [{ id: 'band', name: 'Band', isAdmin: false }] } as never)
    useShowStateStore.setState({ isMaster: false })
    render(<RigCheckView />)
    expect(screen.queryByRole('button', { name: 'Wählen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Vorbereiten' })).toBeNull()
    expect(screen.getByText(/Nur der Master bereitet vor und startet/)).toBeInTheDocument()
  })

  it('a prepared run lists every device live; Start waits until the test song has arrived', () => {
    useShowLogStore.setState({
      events: [{ id: 'rig-check-run-r1', showId: 'r1', type: 'rig-check-run', at: Math.round(getServerTime()), kind: 'quick', version: 1 }, report(), report({ deviceId: 'phone', deviceName: 'Handy', trackReady: false, mode: 'practice' })],
    })
    render(<RigCheckView />)
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(screen.getByText('Fire')).toBeInTheDocument()
    expect(screen.getAllByText(/-12 ms zum Server/)).toHaveLength(2)
    expect(screen.getAllByText(/Bluetooth.*Latenz 230 ms/)).toHaveLength(2)
    expect(screen.getByText('Track lädt …')).toBeInTheDocument()
    expect(screen.getByText('Solo Üben - folgt nicht')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Vorbereiten' })).toBeNull()
  })
})

describe('RigCheckVerdict', () => {
  const ended = () => {
    const now = Math.round(getServerTime())
    return { id: 'rig-check-run-r1', showId: 'r1', type: 'rig-check-run', at: now - 60_000, kind: 'quick', version: 1, startedAt: now - 50_000, endedAt: now - 5_000 } as ShowLogEvent
  }

  it('asks a device that took part, once - "Alles in Ordnung" stores the verdict', async () => {
    useShowLogStore.setState({ events: [ended(), report({ id: `rig-check-device-r1-${getDeviceId()}`, deviceId: getDeviceId() })] })
    const { rerender } = render(<RigCheckVerdict />)
    fireEvent.click(screen.getByRole('button', { name: 'Alles in Ordnung' }))
    await vi.waitFor(() => expect(append).toHaveBeenCalled())
    expect(append.mock.calls[0]![0]).toMatchObject({ type: 'rig-check-device', verdict: 'ok' })
    rerender(<RigCheckVerdict />)
    expect(screen.queryByText('Rig-Check: alles in Ordnung?')).toBeNull()
  })

  it('a problem comes with a note', async () => {
    useShowLogStore.setState({ events: [ended(), report({ id: `rig-check-device-r1-${getDeviceId()}`, deviceId: getDeviceId() })] })
    render(<RigCheckVerdict />)
    fireEvent.click(screen.getByRole('button', { name: 'Problem …' }))
    fireEvent.change(screen.getByLabelText('Was war falsch?'), { target: { value: 'Klick doppelt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Problem melden' }))
    await vi.waitFor(() => expect(append).toHaveBeenCalled())
    expect(append.mock.calls[0]![0]).toMatchObject({ verdict: 'problem', note: 'Klick doppelt' })
  })

  it('stays away from devices that did not take part and from cancelled runs', () => {
    useShowLogStore.setState({ events: [ended()] })
    const { unmount } = render(<RigCheckVerdict />)
    expect(screen.queryByText('Rig-Check: alles in Ordnung?')).toBeNull()
    unmount()
    useShowLogStore.setState({ events: [{ ...ended(), cancelled: true } as ShowLogEvent, report({ id: `rig-check-device-r1-${getDeviceId()}`, deviceId: getDeviceId() })] })
    render(<RigCheckVerdict />)
    expect(screen.queryByText('Rig-Check: alles in Ordnung?')).toBeNull()
  })
})

describe('RigCheckAnalysis', async () => {
  const { RigCheckAnalysis } = await import('./RigCheckAnalysis')
  const section = (name: string, overrides: object = {}) => ({ name, label: name, beats: 32, hitRate: 1, meanAbsMs: 4, maxAbsMs: 9, slipRate: 0, knownLimit: null, ...overrides })

  it('shows per section how close the click is, and where the bars slipped', () => {
    render(
      <RigCheckAnalysis
        check={{
          refine: { bpm: 120, gridPoints: 8, sections: [section('Gleichmäßig 120'), section('Sprung auf 140', { hitRate: 0, meanAbsMs: 78, maxAbsMs: 135, slipRate: 1 }), section('Pause', { beats: 0, knownLimit: 'silent' })] },
          detect: null,
        }}
      />,
    )
    expect(screen.getByText('100 % ≤ 15 ms')).toBeInTheDocument()
    expect(screen.getByText('Takt verschoben (100 %)')).toBeInTheDocument()
    expect(screen.getByText('Nichts erkannt.')).toBeInTheDocument()
    expect(screen.getAllByText('Pause')).toHaveLength(2)
  })
})
