import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const show = vi.hoisted(() => ({
  canControl: true,
  playbackStatus: 'stopped' as string,
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
const { DEFAULT_KEYBINDINGS, PROMPTER_SCROLL_EVENT } = await import('./keybindings')

describe('useFootswitch (#27)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    show.canControl = true
    show.playbackStatus = 'stopped'
    useKeybindingsStore.setState({ bindings: DEFAULT_KEYBINDINGS })
  })

  it('PageDown advances to the next song on a dashboard', () => {
    renderHook(() => useFootswitch(true))
    fireEvent.keyDown(window, { key: 'PageDown' })
    expect(show.next).toHaveBeenCalledTimes(1)
  })

  it('does nothing off the dashboards, without control, or while typing in a field', () => {
    const { rerender } = renderHook(({ active }) => useFootswitch(active), { initialProps: { active: false } })
    fireEvent.keyDown(window, { key: 'PageDown' })
    expect(show.next).not.toHaveBeenCalled()

    rerender({ active: true })
    show.canControl = false
    fireEvent.keyDown(window, { key: 'PageDown' })
    expect(show.next).not.toHaveBeenCalled()

    show.canControl = true
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'PageDown' })
    expect(show.next).not.toHaveBeenCalled()
    input.remove()
  })

  it('play/pause toggles, and the prompter keys page the prompter', () => {
    useKeybindingsStore.setState({ bindings: { ...DEFAULT_KEYBINDINGS, 'play-pause': [' '], 'prompter-down': ['ArrowDown'] } })
    renderHook(() => useFootswitch(true))
    fireEvent.keyDown(window, { key: ' ' })
    expect(show.play).toHaveBeenCalled()
    show.playbackStatus = 'playing'
    fireEvent.keyDown(window, { key: ' ' })
    expect(show.pause).toHaveBeenCalled()

    const onScroll = vi.fn()
    window.addEventListener(PROMPTER_SCROLL_EVENT, onScroll)
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect((onScroll.mock.calls[0][0] as CustomEvent).detail).toEqual({ direction: 1 })
    window.removeEventListener(PROMPTER_SCROLL_EVENT, onScroll)
  })

  it('settings: "Taste zuweisen" assigns the next key pressed and does not trigger it', () => {
    renderHook(() => useFootswitch(true))
    render(<KeybindingSettings />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Taste zuweisen' })[2]) // Play / Pause
    expect(screen.getByRole('button', { name: /Jetzt Pedal drücken/ })).toBeInTheDocument()
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight' })
    })
    expect(useKeybindingsStore.getState().bindings['play-pause']).toEqual(['ArrowRight'])
    expect(show.play).not.toHaveBeenCalled()
    expect(screen.getByText('Pfeil →')).toBeInTheDocument()
  })
})
