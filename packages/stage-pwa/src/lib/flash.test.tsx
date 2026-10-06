import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseAlertDirective, parseChordPro, songAlerts, tappableLines } from './chordpro'

vi.mock('./clockSync', () => ({ getServerTime: () => Date.now() }))
const me = { id: 'p-guitar', name: 'Caro' }
vi.mock('./useActiveProfile', () => ({ useActiveProfile: () => me }))

const { FlashOverlay } = await import('../components/FlashOverlay')
const { usePresenceStore } = await import('../store/usePresenceStore')
const { useFlashPrefsStore } = await import('../store/useFlashPrefsStore')
const { showLocalFlash } = await import('./flash')

describe('song alerts {alert: ...} (#26)', () => {
  const song = ['[00:01.00]First line', '[00:10.00] {alert: Noch 4 Takte}', '{alert: ohne Zeit}', '[00:20.00]Last line'].join('\n')

  it('parses timed alerts and leaves them out of the lyrics and of Tap-to-Sync', () => {
    expect(parseAlertDirective('[00:10.00] {alert: VAMP}')).toEqual({ text: 'VAMP', timeMs: 10000 })
    expect(parseAlertDirective('{Alert:  Schluss! }')).toEqual({ text: 'Schluss!', timeMs: null })
    expect(parseAlertDirective('Normal line')).toBeNull()
    expect(songAlerts(song)).toEqual([{ timeMs: 10000, text: 'Noch 4 Takte' }])
    expect(parseChordPro(song).map((l) => l.segments.map((s) => s.text).join(''))).toEqual(['First line', 'Last line'])
    expect(tappableLines(song.split('\n'))).toEqual([true, false, false, true])
  })
})

describe('FlashOverlay (#26)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useFlashPrefsStore.setState({ mode: 'fullscreen' })
    usePresenceStore.setState({ presence: { devices: {} } })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a fresh message from another device big, with the sender, and hides it after a few seconds', () => {
    render(<FlashOverlay />)
    act(() => usePresenceStore.setState({ presence: { devices: {}, flash: { id: 'f1', text: 'VAMP', from: 'Caro', at: Date.now() } } }))
    expect(screen.getByRole('alert')).toHaveTextContent('VAMP')
    expect(screen.getByRole('alert')).toHaveTextContent('Caro')
    act(() => vi.advanceTimersByTime(8_100))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('ignores an old message (e.g. arriving with the first snapshot) and can be tapped away', () => {
    render(<FlashOverlay />)
    act(() => usePresenceStore.setState({ presence: { devices: {}, flash: { id: 'old', text: 'Alt', at: Date.now() - 60_000 } } }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    act(() => showLocalFlash('Noch 4 Takte'))
    fireEvent.click(screen.getByRole('alert'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('stays silent when switched off on this device', () => {
    useFlashPrefsStore.setState({ mode: 'off' })
    render(<FlashOverlay />)
    act(() => usePresenceStore.setState({ presence: { devices: {}, flash: { id: 'f2', text: 'VAMP', at: Date.now() } } }))
    act(() => showLocalFlash('Lokal'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('banner (default): a strip at the top that lets touches through to the dashboard', () => {
    useFlashPrefsStore.setState({ mode: 'banner' })
    render(<FlashOverlay />)
    act(() => usePresenceStore.setState({ presence: { devices: {}, flash: { id: 'f3', text: 'Letzter Song', from: 'Marco', at: Date.now() } } }))
    const banner = screen.getByRole('alert')
    expect(banner).toHaveTextContent('Letzter Song')
    expect(banner.className).toContain('pointer-events-none')
    expect(banner.className).not.toContain('inset-0')
    act(() => vi.advanceTimersByTime(8_100))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a message for someone else stays on their tablet only', () => {
    render(<FlashOverlay />)
    act(() => usePresenceStore.setState({ presence: { devices: {}, flash: { id: 'f4', text: 'Bass stimmen', to: ['p-bass'], at: Date.now() } } }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    act(() => usePresenceStore.setState({ presence: { devices: {}, flash: { id: 'f5', text: 'Gitarre stimmen', to: ['p-bass', 'p-guitar'], at: Date.now() } } }))
    expect(screen.getByRole('alert')).toHaveTextContent('Gitarre stimmen')
  })
})
