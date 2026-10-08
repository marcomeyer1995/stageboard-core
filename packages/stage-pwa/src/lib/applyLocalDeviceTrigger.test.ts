import { describe, expect, it, vi } from 'vitest'

const kemper = vi.hoisted(() => vi.fn(async () => ({ status: 'ok' as const })))
vi.mock('./clientTranslator', () => ({ getTranslator: (capability: string) => (capability === 'kemper-control' ? kemper : null) }))

const { applyLocalDeviceTrigger } = await import('./applyLocalDeviceTrigger')

describe('applyLocalDeviceTrigger (#408 review)', () => {
  it('a relayed Kemper trigger reaches the Kemper translator, still naming its device', () => {
    const event = { type: 'kemper.selectRig', payload: { bank: 7, slot: 3 }, logicalDeviceId: 'k2' }
    applyLocalDeviceTrigger({ capability: 'kemper-control', event } as never)
    expect(kemper).toHaveBeenCalledWith(event)
  })

  it('a capability without a translator here is reported, not thrown', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => applyLocalDeviceTrigger({ capability: 'nothing-here', event: { type: 'x', payload: {} } } as never)).not.toThrow()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
