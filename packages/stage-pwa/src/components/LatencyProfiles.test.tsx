import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))

const { getDeviceId } = await import('../lib/deviceId')
const { LatencyProfileDialog } = await import('./LatencyProfiles')

describe('LatencyProfileDialog (Marco, 2026-10-16: the switch sits beside its values)', () => {
  it('this device: "Ton-Latenz ausgleichen" on top of the values', () => {
    render(<LatencyProfileDialog deviceId={getDeviceId()} deviceName="Xiaomi" onClose={() => {}} />)
    expect(screen.getByText('Ton-Latenz ausgleichen')).toBeInTheDocument()
  })

  it('another tablet: only its values - the switch is that tablet\'s own', () => {
    render(<LatencyProfileDialog deviceId="other-tablet" deviceName="Fire" onClose={() => {}} />)
    expect(screen.queryByText('Ton-Latenz ausgleichen')).not.toBeInTheDocument()
  })
})
