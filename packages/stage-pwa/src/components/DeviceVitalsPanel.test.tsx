import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import '../i18n'
import { useDeviceVitalsStore, type VitalsSnapshot } from '../lib/deviceVitals'
import { useNativeOutputStore } from '../lib/nativeOutput'
import { DeviceVitalsPanel } from './DeviceVitalsPanel'

/** Marco's phone after 17 h (2026-11-06). */
const PHONE: VitalsSnapshot = {
  at: 0,
  audio: { path: 'native', delayMs: 332, missingMs: 13967, jumps: 2, leadMinMs: 3 },
  audioClock: { pct: -0.6, losses: 4, worstLossMs: 128 },
  native: { availMb: 250, totalMb: 11190, thresholdMb: 216, lowMemory: false, appMb: 213, cpuMs: 0, uptimeMs: 0, cores: 8, cpuPct: 14 },
  jsHeapMb: 80,
  jsHeapLimitMb: 1024,
  stallsPerMin: 0,
  worstFrameMs: 40,
  framesWatched: true,
  uptimeMs: (17 * 60 + 35) * 60_000,
  clock: { offsetMs: 37.7, uncertaintyMs: 0.9, rttMs: 12, ageMs: 2000 },
}

describe('DeviceVitalsPanel', () => {
  beforeEach(() => {
    useNativeOutputStore.setState({ fellBack: null })
  })

  it('names what is wrong on top and shows each value with its light', () => {
    useDeviceVitalsStore.setState({ snapshot: PHONE })
    render(<DeviceVitalsPanel />)
    expect(screen.getByRole('status')).toHaveTextContent('Ton-Aussetzer · Audio-Uhr unruhig · Ton-Reserve knapp · Speicher knapp')
    expect(screen.getByRole('status')).toHaveClass('text-warn')
    expect(screen.getByText('13.967 ms')).toBeInTheDocument()
    expect(screen.getByText(/-0,60 %/)).toHaveTextContent('-0,60 % · 4 Hänger (bis 128 ms)')
    expect(screen.getByText('250 MB von 10,9 GB')).toBeInTheDocument()
    expect(screen.getByText('14 % eines Kerns (8 Kerne)')).toBeInTheDocument()
    expect(screen.getByText('17 h 35 min')).toBeInTheDocument()
    expect(screen.getByText('±0,9 ms')).toBeInTheDocument()
  })

  it('after the fallback says so and offers to try the native output again', () => {
    useNativeOutputStore.setState({ fellBack: { at: 0, missingMs: 2100 }, wanted: true })
    useDeviceVitalsStore.setState({ snapshot: { ...PHONE, audio: { path: 'webview', delayMs: null, missingMs: 0, jumps: 0, leadMinMs: null, fellBack: true } } })
    render(<DeviceVitalsPanel />)
    expect(screen.getByRole('status')).toHaveTextContent('Ton im Notbetrieb')
    expect(screen.getByText(/Notbetrieb über die WebView seit/)).toHaveTextContent('2.100 ms Ton fehlten')
    fireEvent.click(screen.getByRole('button', { name: 'Native Ausgabe wieder versuchen' }))
    expect(useNativeOutputStore.getState().wanted).toBe(true)
  })

  it('without a timestamp from Android says the timing is only estimated', () => {
    useDeviceVitalsStore.setState({ snapshot: { ...PHONE, audio: { path: 'native', delayMs: 420, missingMs: 0, jumps: 0, leadMinMs: 300, estimated: true } } })
    render(<DeviceVitalsPanel />)
    expect(screen.getByText(/Zeitpunkt nur geschätzt/)).toBeInTheDocument()
  })

  it('a healthy browser: all good, memory only in the app', () => {
    useDeviceVitalsStore.setState({ snapshot: { ...PHONE, audio: null, native: null, audioClock: null, clock: { offsetMs: 0, uncertaintyMs: null, rttMs: null, ageMs: null } } })
    render(<DeviceVitalsPanel />)
    expect(screen.getByRole('status')).toHaveTextContent('Alles in Ordnung')
    expect(screen.getAllByText('nur in der App messbar')).toHaveLength(2)
  })
})
