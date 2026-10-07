import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_STATUS_BAR_ORDER } from '../lib/statusBarItems'
import { useStatusBarPrefsStore } from '../store/useStatusBarPrefsStore'
import { StatusBarSettings } from './StatusBarSettings'

describe('StatusBarSettings', () => {
  beforeEach(() => useStatusBarPrefsStore.getState().reset())

  it('moves an item up the ranking, hides one, and resets to the default', () => {
    render(<StatusBarSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Uhrzeit wichtiger' }))
    expect(useStatusBarPrefsStore.getState().order.slice(0, 3)).toEqual(['duration', 'clock', 'master'])
    fireEvent.click(screen.getByRole('switch', { name: 'Gig / Solo' }))
    expect(useStatusBarPrefsStore.getState().hidden).toEqual(['mode'])
    fireEvent.click(screen.getByRole('button', { name: 'Standard wiederherstellen' }))
    expect(useStatusBarPrefsStore.getState().order).toEqual([...DEFAULT_STATUS_BAR_ORDER])
    expect(useStatusBarPrefsStore.getState().hidden).toEqual([])
  })
})
