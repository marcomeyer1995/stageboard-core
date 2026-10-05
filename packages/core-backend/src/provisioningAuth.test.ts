import { describe, expect, it } from 'vitest'
import { isLoopback } from './provisioningAuth.js'

describe('isLoopback - the Stage-Server machine itself (#364)', () => {
  it('accepts loopback in every spelling', () => {
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(isLoopback(ip, new Set())).toBe(true)
  })

  it("accepts the machine's own LAN address - a browser on the server laptop using its LAN IP", () => {
    const own = new Set(['192.168.178.158', '::ffff:192.168.178.158'])
    expect(isLoopback('192.168.178.158', own)).toBe(true)
    expect(isLoopback('::ffff:192.168.178.158', own)).toBe(true)
  })

  it('rejects every other device on the network', () => {
    expect(isLoopback('192.168.178.179', new Set(['192.168.178.158']))).toBe(false)
  })
})
