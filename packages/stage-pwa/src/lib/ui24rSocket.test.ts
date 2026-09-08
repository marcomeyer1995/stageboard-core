import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  sent: string[] = []
  private listeners: Record<string, ((event: unknown) => void)[]> = {}

  constructor(public url: string) {}

  addEventListener(type: string, handler: (event: unknown) => void): void {
    ;(this.listeners[type] ??= []).push(handler)
  }
  removeEventListener(type: string, handler: (event: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((h) => h !== handler)
  }
  send(data: string): void {
    this.sent.push(data)
  }
  emitOpen(): void {
    this.readyState = MockWebSocket.OPEN
    this.listeners.open?.forEach((h) => h({}))
  }
  emitMessage(data: string): void {
    this.listeners.message?.forEach((h) => h({ data }))
  }
  emitError(): void {
    this.listeners.error?.forEach((h) => h({}))
  }
  emitClose(): void {
    this.readyState = MockWebSocket.CLOSED
    this.listeners.close?.forEach((h) => h({}))
  }
}

let created: MockWebSocket[] = []

beforeEach(() => {
  vi.useFakeTimers()
  created = []
  vi.stubGlobal(
    'WebSocket',
    class extends MockWebSocket {
      constructor(url: string) {
        super(url)
        created.push(this)
      }
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.resetModules()
})

describe('ui24rSocket', () => {
  it('resolves getUi24rConnection once the socket opens, connecting to ws://host:port/', async () => {
    const { getUi24rConnection } = await import('./ui24rSocket')
    const promise = getUi24rConnection('192.168.1.50', 8080)
    expect(created).toHaveLength(1)
    expect(created[0].url).toBe('ws://192.168.1.50:8080/')
    created[0].emitOpen()
    const connection = await promise
    expect(connection.ws).toBe(created[0])
  })

  it('rejects if the socket errors before opening', async () => {
    const { getUi24rConnection } = await import('./ui24rSocket')
    const promise = getUi24rConnection('192.168.1.50', 8080)
    created[0].emitError()
    await expect(promise).rejects.toThrow()
  })

  it('rejects on timeout if the socket never opens', async () => {
    const { getUi24rConnection } = await import('./ui24rSocket')
    const promise = getUi24rConnection('192.168.1.50', 8080, 1000)
    const assertion = expect(promise).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })

  it('reuses the cached connection for the same host:port', async () => {
    const { getUi24rConnection } = await import('./ui24rSocket')
    const p1 = getUi24rConnection('192.168.1.50', 8080)
    created[0].emitOpen()
    await p1
    await getUi24rConnection('192.168.1.50', 8080)
    expect(created).toHaveLength(1)
  })

  it('parses incoming SETD/SETS lines (possibly multiple per 3::: envelope) into connection.state', async () => {
    const { getUi24rConnection } = await import('./ui24rSocket')
    const promise = getUi24rConnection('192.168.1.50', 8080)
    created[0].emitOpen()
    const connection = await promise
    created[0].emitMessage('3:::SETS^model^ui24\nSETD^i.0.mix^0.764706')
    expect(connection.state.get('model')).toBe('ui24')
    expect(connection.state.get('i.0.mix')).toBeCloseTo(0.764706, 6)
  })

  it('echoes 2:: heartbeats back', async () => {
    const { getUi24rConnection } = await import('./ui24rSocket')
    const promise = getUi24rConnection('192.168.1.50', 8080)
    created[0].emitOpen()
    await promise
    created[0].emitMessage('2::')
    expect(created[0].sent).toContain('2::')
  })

  it('sendUi24r wraps a numeric value as SETD and a string value as SETS, both 3:::-framed', async () => {
    const { getUi24rConnection, sendUi24r } = await import('./ui24rSocket')
    const promise = getUi24rConnection('192.168.1.50', 8080)
    created[0].emitOpen()
    const connection = await promise
    sendUi24r(connection, 'i.0.mute', 1)
    sendUi24r(connection, 'i.0.name', 'VOCAL')
    expect(created[0].sent).toContain('3:::SETD^i.0.mute^1')
    expect(created[0].sent).toContain('3:::SETS^i.0.name^VOCAL')
  })
})
