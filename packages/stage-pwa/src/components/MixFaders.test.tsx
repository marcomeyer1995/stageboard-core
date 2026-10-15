import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { __resetAudioMixForTests, useAudioMixStore } from '../lib/audioMix'
import { MixFaders } from './MixFaders'

afterEach(() => {
  __resetAudioMixForTests()
  localStorage.clear()
})

describe('MixFaders - Mein Mix (docs/21 §9.3)', () => {
  it('sets a level and mutes a source; the track stops at 100 %, click and voice at 200 %', () => {
    render(<MixFaders orientation="vertical" />)
    const voice = screen.getByRole('slider', { name: 'Ansagen' })
    expect(voice).toHaveAttribute('max', '200')
    expect(screen.getByRole('slider', { name: 'Track' })).toHaveAttribute('max', '100')
    fireEvent.change(voice, { target: { value: '150' } })
    expect(useAudioMixStore.getState().mix.voice.level).toBe(1.5)
    fireEvent.click(screen.getAllByRole('button', { name: /Stumm/ })[1]!)
    expect(useAudioMixStore.getState().mix.click.muted).toBe(true)
    expect(screen.getByText('stumm')).toBeInTheDocument()
  })
})
