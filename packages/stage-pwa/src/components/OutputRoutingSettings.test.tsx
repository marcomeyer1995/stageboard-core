import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { __resetAudioMixForTests, useOutputRoutingStore } from '../lib/audioMix'
import { OutputRoutingSettings } from './OutputRoutingSettings'

afterEach(() => {
  __resetAudioMixForTests()
  localStorage.clear()
})

describe('OutputRoutingSettings (#481)', () => {
  it('starts mixed and switches to click left / track right', () => {
    render(<OutputRoutingSettings />)
    expect(screen.getByRole('radio', { name: /Alles gemischt/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: /Klick links · Track rechts/ }))
    expect(useOutputRoutingStore.getState().routing).toBe('click-left')
    expect(screen.getByRole('radio', { name: /Klick links · Track rechts/ })).toHaveAttribute('aria-checked', 'true')
  })
})
