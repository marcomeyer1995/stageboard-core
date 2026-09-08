import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceTransportConfig, LogicalDevice } from 'shared-types'

const sendUi24r = vi.fn()
const getUi24rConnection = vi.fn()
vi.mock('./ui24rSocket', () => ({
  getUi24rConnection: (...args: unknown[]) => getUi24rConnection(...args),
  sendUi24r: (...args: unknown[]) => sendUi24r(...args),
}))

// Same reasoning as mg30Translator.test.ts/rc500Translator.test.ts - this module
// transitively imports workspaceDb.ts, which constructs a real PouchDB at module load time.
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { UI24R_CAPABILITY, ui24rTranslator } = await import('./ui24rTranslator')
const { getDeviceId } = await import('./deviceId')
const { useDeviceTransportConfigStore } = await import('../store/useDeviceTransportConfigStore')
const { useLogicalDevicesStore } = await import('../store/useLogicalDevicesStore')

const LOGICAL_DEVICE: LogicalDevice = {
  id: 'ui24r-1',
  name: 'Marcos Ui24R',
  capability: UI24R_CAPABILITY,
  pluginId: null,
  executionTarget: null,
}

function configWith(values: Record<string, string>): DeviceTransportConfig {
  return { id: `${getDeviceId()}:ui24r-1`, deviceId: getDeviceId(), logicalDeviceId: 'ui24r-1', transportId: 'network-ws', values }
}

let connectionState: Map<string, number | string>

beforeEach(() => {
  connectionState = new Map()
  getUi24rConnection.mockReset().mockResolvedValue({ ws: {}, state: connectionState })
  sendUi24r.mockReset()
  useLogicalDevicesStore.setState({ devices: [LOGICAL_DEVICE], loaded: true })
  useDeviceTransportConfigStore.setState({ configs: [configWith({ host: '192.168.1.50', port: '80' })], loaded: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ui24rTranslator', () => {
  it('errors when no Logical Device declares ui24r-control', async () => {
    useLogicalDevicesStore.setState({ devices: [] })
    const result = await ui24rTranslator({ type: 'ui24r.setMute', payload: { channelType: 'i', channel: 1, mute: true } })
    expect(result.status).toBe('error')
  })

  it('errors when no DeviceTransportConfig is set up for this tablet', async () => {
    useDeviceTransportConfigStore.setState({ configs: [] })
    const result = await ui24rTranslator({ type: 'ui24r.setMute', payload: { channelType: 'i', channel: 1, mute: true } })
    expect(result.status).toBe('error')
  })

  it('errors when the connection fails to open', async () => {
    getUi24rConnection.mockRejectedValue(new Error('connection refused'))
    const result = await ui24rTranslator({ type: 'ui24r.setMute', payload: { channelType: 'i', channel: 1, mute: true } })
    expect(result.status).toBe('error')
  })

  it('errors on an unknown event type', async () => {
    const result = await ui24rTranslator({ type: 'something.else' })
    expect(result.status).toBe('error')
  })

  it('passes host/port from the DeviceTransportConfig to getUi24rConnection', async () => {
    await ui24rTranslator({ type: 'ui24r.setMute', payload: { channelType: 'i', channel: 1, mute: true } })
    expect(getUi24rConnection).toHaveBeenCalledWith('192.168.1.50', 80)
  })

  describe('ui24r.setMute', () => {
    it('sends SETD^<type>.<n-1>.mute^1 for mute=true', async () => {
      const result = await ui24rTranslator({ type: 'ui24r.setMute', payload: { channelType: 'i', channel: 1, mute: true } })
      expect(result.status).toBe('ok')
      expect(sendUi24r).toHaveBeenCalledWith(expect.anything(), 'i.0.mute', 1)
    })

    it('sends 0 for mute=false', async () => {
      await ui24rTranslator({ type: 'ui24r.setMute', payload: { channelType: 's', channel: 3, mute: false } })
      expect(sendUi24r).toHaveBeenCalledWith(expect.anything(), 's.2.mute', 0)
    })

    it('rejects a channel number beyond that type\'s real slot count', async () => {
      const result = await ui24rTranslator({ type: 'ui24r.setMute', payload: { channelType: 'l', channel: 3, mute: true } }) // l has only 2
      expect(result.status).toBe('error')
      expect(sendUi24r).not.toHaveBeenCalled()
    })

    it('rejects an unknown channel type', async () => {
      const result = await ui24rTranslator({ type: 'ui24r.setMute', payload: { channelType: 'x', channel: 1, mute: true } })
      expect(result.status).toBe('error')
    })
  })

  describe('ui24r.setLevel', () => {
    it('sends the dB value converted through the real fader curve', async () => {
      const result = await ui24rTranslator({ type: 'ui24r.setLevel', payload: { channelType: 'i', channel: 5, db: 0 } })
      expect(result.status).toBe('ok')
      expect(sendUi24r).toHaveBeenCalledWith(expect.anything(), 'i.4.mix', expect.closeTo(0.76470588235, 8))
    })

    it('rejects a non-numeric db', async () => {
      const result = await ui24rTranslator({ type: 'ui24r.setLevel', payload: { channelType: 'i', channel: 1, db: 'loud' } })
      expect(result.status).toBe('error')
      expect(sendUi24r).not.toHaveBeenCalled()
    })
  })

  describe('test', () => {
    it('reports the model once the initial state dump has populated it', async () => {
      connectionState.set('model', 'ui24')
      const result = await ui24rTranslator({ type: 'test' })
      expect(result.status).toBe('ok')
      expect(result.message).toContain('ui24')
      expect(sendUi24r).not.toHaveBeenCalled()
    })

    it('errors when the model never arrives within the timeout', async () => {
      const result = await ui24rTranslator({ type: 'test' })
      expect(result.status).toBe('error')
    }, 2000)
  })
})
