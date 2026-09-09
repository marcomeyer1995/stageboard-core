import { beforeEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { useSyncStore } from '../store/useSyncStore'
import { useBrowserOnlineStatus } from './useBrowserOnlineStatus'

function Harness() {
  useBrowserOnlineStatus()
  return null
}

beforeEach(() => {
  useSyncStore.setState({ browserOffline: false })
})

describe('useBrowserOnlineStatus', () => {
  it('sets browserOffline on a window "offline" event', () => {
    render(<Harness />)
    window.dispatchEvent(new Event('offline'))
    expect(useSyncStore.getState().browserOffline).toBe(true)
  })

  it('clears browserOffline on a window "online" event', () => {
    useSyncStore.setState({ browserOffline: true })
    render(<Harness />)
    window.dispatchEvent(new Event('online'))
    expect(useSyncStore.getState().browserOffline).toBe(false)
  })

  it('stops reacting to events once unmounted', () => {
    const { unmount } = render(<Harness />)
    unmount()
    window.dispatchEvent(new Event('offline'))
    expect(useSyncStore.getState().browserOffline).toBe(false)
  })
})
