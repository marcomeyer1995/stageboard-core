import { act, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleBack, installBackGuard, useBackHandler } from './backNavigation'

function Closable({ name, onBack }: { name: string; onBack: (name: string) => void }) {
  useBackHandler(() => onBack(name))
  return null
}

function Toggle({ onBack }: { onBack: () => void }) {
  const [open, setOpen] = useState(false)
  useBackHandler(open ? onBack : null)
  return (
    <button type="button" onClick={() => setOpen(true)}>
      open
    </button>
  )
}

describe('useBackHandler', () => {
  it('runs the topmost handler: parent before child, later before earlier', () => {
    const calls: string[] = []
    const onBack = (name: string) => calls.push(name)
    const { rerender, unmount } = render(<Closable name="editor" onBack={onBack} />)
    expect(handleBack()).toBe(true)
    expect(calls).toEqual(['editor'])

    // Parent and child mounting together: the child is on top.
    rerender(
      <>
        <Closable name="editor" onBack={onBack} />
        <Closable name="dialog" onBack={onBack} />
      </>,
    )
    handleBack()
    expect(calls).toEqual(['editor', 'dialog'])
    unmount()
    expect(handleBack()).toBe(false)
  })

  it('a handler activated later wins over one mounted earlier (app-wide dialog host)', () => {
    const host = vi.fn()
    const editor = vi.fn()
    const { getByText } = render(
      <>
        <Toggle onBack={host} />
        <Closable name="editor" onBack={editor} />
      </>,
    )
    handleBack()
    expect(editor).toHaveBeenCalledTimes(1)

    act(() => getByText('open').click())
    handleBack()
    expect(host).toHaveBeenCalledTimes(1)
    expect(editor).toHaveBeenCalledTimes(1)
  })
})

describe('installBackGuard', () => {
  let uninstall: (() => void) | null = null
  afterEach(() => {
    uninstall?.()
    uninstall = null
  })

  it('adds its guard entry on the first interaction, and on Back steps forward onto it and closes the view', () => {
    const pushState = vi.spyOn(window.history, 'pushState')
    window.history.replaceState(null, '')
    uninstall = installBackGuard()
    expect(pushState).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('pointerdown'))
    expect(pushState).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('pointerdown'))
    expect(pushState).toHaveBeenCalledTimes(1) // already on the guard entry

    const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => {})
    const closed = vi.fn()
    const { unmount } = render(<Closable name="x" onBack={closed} />)
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    expect(forward).toHaveBeenCalledTimes(1) // back onto the existing guard entry, no new one
    expect(pushState).toHaveBeenCalledTimes(1)
    expect(closed).toHaveBeenCalledTimes(1)

    // Forward onto the guard entry is not a Back.
    window.dispatchEvent(new PopStateEvent('popstate', { state: { stageboardBackGuard: true } }))
    expect(closed).toHaveBeenCalledTimes(1)
    unmount()
    pushState.mockRestore()
    forward.mockRestore()
  })
})
