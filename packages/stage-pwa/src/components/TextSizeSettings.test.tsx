import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MAX_CONTENT_FONT_SIZE, useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { TextSizeSettings } from './TextSizeSettings'

describe('TextSizeSettings (Marco, 2026-10-16: no slider that a scrolling finger moves)', () => {
  it('− and + change the size one step, + stops at the maximum', () => {
    useContentFontSizeStore.setState({ baseFontSize: 20 })
    render(<TextSizeSettings />)
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Größer' }))
    expect(useContentFontSizeStore.getState().baseFontSize).toBe(21)
    fireEvent.click(screen.getByRole('button', { name: 'Kleiner' }))
    fireEvent.click(screen.getByRole('button', { name: 'Kleiner' }))
    expect(useContentFontSizeStore.getState().baseFontSize).toBe(19)
    act(() => useContentFontSizeStore.setState({ baseFontSize: MAX_CONTENT_FONT_SIZE }))
    expect(screen.getByRole('button', { name: 'Größer' })).toBeDisabled()
  })
})
