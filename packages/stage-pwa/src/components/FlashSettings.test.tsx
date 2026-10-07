import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LOCAL_FLASH_EVENT } from '../lib/flash'
import { useFlashPrefsStore } from '../store/useFlashPrefsStore'
import { FlashSettings } from './FlashSettings'

describe('FlashSettings', () => {
  it('"Vorschau" shows a sample on this device only, in the chosen look; hidden when switched off', () => {
    useFlashPrefsStore.setState({ mode: 'banner' })
    const seen = vi.fn()
    window.addEventListener(LOCAL_FLASH_EVENT, seen)
    const { rerender } = render(<FlashSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
    expect(seen).toHaveBeenCalledTimes(1)
    expect((seen.mock.calls[0]![0] as CustomEvent<{ text: string }>).detail.text).toContain('Vorschau')
    window.removeEventListener(LOCAL_FLASH_EVENT, seen)

    useFlashPrefsStore.setState({ mode: 'off' })
    rerender(<FlashSettings />)
    expect(screen.queryByRole('button', { name: 'Vorschau' })).not.toBeInTheDocument()
  })
})
