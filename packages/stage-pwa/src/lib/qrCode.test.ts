import { describe, expect, it } from 'vitest'
import { decodeQrFrame, renderQrCode } from './qrCode'

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
