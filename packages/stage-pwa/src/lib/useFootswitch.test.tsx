import { fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const show = vi.hoisted(() => ({
  canControl: true,
  playbackStatus: 'stopped' as 'playing' | 'paused' | 'stopped',
  trackEnded: false,
  elapsedMs: null as number | null,
  liveTempoAdjustPercent: 0,
  queue: { currentSong: { bpm: 120, timeSignature: '4/4' }, currentVariant: null as null | object },
  next: vi.fn(async () => {}),
  previous: vi.fn(async () => {}),
  play: vi.fn(async () => {}),
  pause: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
}))
vi.mock('./showMode', () => ({ useShowMode: () => show }))

const { useFootswitch } = await import('./useFootswitch')
const { useKeybindingsStore } = await import('../store/useKeybindingsStore')
const { KeybindingSettings } = await import('../components/KeybindingSettings')
const { ONE_BUTTON_SHOW, PROMPTER_SCROLL_EVENT } = await import('./keybindings')

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(show, { canControl: true, playbackStatus: 'stopped', trackEnded: false, elapsedMs: null })
  useKeybindingsStore.setState({ bindings: [] })
})

describe('useFootswitch (#27)', () => {
  it('a fixed key does its one thing - only on a dashboard, with control, not while typing', async () => {
    useKeybindingsStore.setState({ bindings: [{ key: 'PageDown', action: { kind: 'fixed', action: 'next' } }] })
    const { rerender } = renderHook(({ active }) => useFootswitch(active), { initialProps: { active: true } })
    fireEvent.keyDown(window, { key: 'PageDown' })
    expect(show.next).toHaveBeenCalledTimes(1)

    show.canControl = false
    fireEvent.keyDown(window, { key: 'PageDown' })
    show.canControl = true
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'PageDown' })
    input.remove()
    rerender({ active: false })
    fireEvent.keyDown(window, { key: 'PageDown' })
    expect(show.next).toHaveBeenCalledTimes(1)
  })

  it('"Ein-Tasten-Show": one key runs the show through every song state', async () => {
    useKeybindingsStore.setState({ bindings: [{ key: 'b', action: { kind: 'by-state', steps: ONE_BUTTON_SHOW } }] })
    renderHook(() => useFootswitch(true))
    const press = async () => {
      fireEvent.keyDown(window, { key: 'b' })
      await flush()
      await flush() // "start the next song" waits one more task (track load), like the auto-advance
    }

    await press() // Bereit -> Play
    expect(show.play).toHaveBeenCalledTimes(1)

    show.playbackStatus = 'playing'
    show.elapsedMs = -500 // still counting in
    await press()
    expect(show.stop).not.toHaveBeenCalled()

    show.elapsedMs = 30_000 // Spielt -> Stop & nächster Song
    await press()
    expect(show.stop).toHaveBeenCalledTimes(1)
    expect(show.next).toHaveBeenCalledTimes(1)
    expect(show.stop.mock.invocationCallOrder[0]).toBeLessThan(show.next.mock.invocationCallOrder[0]!)

    show.playbackStatus = 'paused' // Pause -> Fortsetzen
    await press()
    expect(show.play).toHaveBeenCalledTimes(2)

    show.playbackStatus = 'stopped' // Beendet -> Nächster Song und starten
    show.trackEnded = true
    await press()
    expect(show.next).toHaveBeenCalledTimes(2)
    expect(show.play).toHaveBeenCalledTimes(3)
  })

  it('prompter keys page the prompter', () => {
    useKeybindingsStore.setState({ bindings: [{ key: 'ArrowDown', action: { kind: 'fixed', action: 'prompter-down' } }] })
    const listener = vi.fn()
    window.addEventListener(PROMPTER_SCROLL_EVENT, listener)
    renderHook(() => useFootswitch(true))
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect((listener.mock.calls[0]![0] as CustomEvent).detail).toEqual({ direction: 1 })
    window.removeEventListener(PROMPTER_SCROLL_EVENT, listener)
  })
})

describe('KeybindingSettings (#27)', () => {
  it('starts empty; a new mapping is made in the popup: press the pedal, choose, save', () => {
    render(<KeybindingSettings />)
    expect(screen.getByText('Noch keine Zuordnung.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Neue Zuordnung' }))
    const dialog = screen.getByRole('dialog', { name: 'Neue Zuordnung' })
    expect(within(dialog).getByText('Jetzt Pedal drücken …')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'PageDown' })
    expect(show.next).not.toHaveBeenCalled() // captured, not executed
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Je nach Zustand des Songs' }))
    expect(within(dialog).getByLabelText('Wenn Spielt')).toHaveValue('stop-next')
    fireEvent.change(within(dialog).getByLabelText('Wenn Spielt'), { target: { value: 'pause' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))
    expect(useKeybindingsStore.getState().bindings).toEqual([
      { key: 'PageDown', action: { kind: 'by-state', steps: { ...ONE_BUTTON_SHOW, playing: 'pause' } } },
    ])
    expect(screen.getByText(/Spielt → Pause/)).toBeInTheDocument()
  })

  it('tapping a mapping edits it, ✕ deletes it, and a taken key is announced', () => {
    useKeybindingsStore.setState({
      bindings: [
        { key: 'PageDown', action: { kind: 'fixed', action: 'next' } },
        { key: 'PageUp', action: { kind: 'fixed', action: 'previous' } },
      ],
    })
    render(<KeybindingSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Nächster Song' }))
    const dialog = screen.getByRole('dialog', { name: 'Zuordnung ändern' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Andere Taste' }))
    fireEvent.keyDown(window, { key: 'PageUp' })
    expect(within(dialog).getByText(/ist schon belegt/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))
    expect(useKeybindingsStore.getState().bindings).toEqual([{ key: 'PageUp', action: { kind: 'fixed', action: 'next' } }])
    fireEvent.click(screen.getByRole('button', { name: 'Zuordnung für Bild ↑ löschen' }))
    expect(useKeybindingsStore.getState().bindings).toEqual([])
  })
})
