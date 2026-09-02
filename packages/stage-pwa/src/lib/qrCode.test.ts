import { describe, expect, it } from 'vitest'
import { buildJoinUrl, decodeQrFrame, parseJoinPayload, renderQrCode } from './qrCode'

describe('renderQrCode', () => {
  it('renders a QR code as a PNG data URL', async () => {
    const url = await renderQrCode('12345678')
    expect(url).toMatch(/^data:image\/png;base64,/)
  })
})

describe('decodeQrFrame', () => {
  it('returns null for a blank frame (no QR code present)', () => {
    const width = 64
    const height = 64
    const blank = new ImageData(width, height)
    expect(decodeQrFrame(blank)).toBeNull()
  })

  // A real render-then-decode round trip needs actual canvas 2D pixel rendering, which
  // happy-dom doesn't implement (getContext('2d') has no working drawImage/getImageData) -
  // verified live in a real browser instead (see #21's verification notes).
})

describe('buildJoinUrl', () => {
  it('embeds the host, workspace, and code as a real https:// URL', () => {
    expect(buildJoinUrl('192.168.178.158', 'band-a', '12345678')).toBe(
      'https://192.168.178.158/?ws=band-a&code=12345678',
    )
  })
})

describe('parseJoinPayload', () => {
  it('parses a buildJoinUrl URL back into its workspace/code pair', () => {
    const url = buildJoinUrl('192.168.178.158', 'band-a', '12345678')
    expect(parseJoinPayload(url)).toEqual({ workspaceId: 'band-a', code: '12345678' })
  })

  it('still parses the legacy plain workspaceId:code format', () => {
    expect(parseJoinPayload('band-a:12345678')).toEqual({ workspaceId: 'band-a', code: '12345678' })
  })

  it('returns null for unrelated text', () => {
    expect(parseJoinPayload('https://example.com/')).toBeNull()
    expect(parseJoinPayload('not a code at all')).toBeNull()
    expect(parseJoinPayload('')).toBeNull()
  })
})
