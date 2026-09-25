import { describe, expect, it } from 'vitest'
import { isYoutubeUrl } from './asyncJob.js'

describe('isYoutubeUrl', () => {
  it('accepts the common YouTube URL shapes', () => {
    expect(isYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
    expect(isYoutubeUrl('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
    expect(isYoutubeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
    expect(isYoutubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true)
    expect(isYoutubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(true)
  })

  it('tolerates surrounding whitespace (a pasted link often has some)', () => {
    expect(isYoutubeUrl('  https://youtu.be/dQw4w9WgXcQ  ')).toBe(true)
  })

  it('rejects everything that is not youtube.com/youtu.be', () => {
    expect(isYoutubeUrl('https://vimeo.com/12345678')).toBe(false)
    expect(isYoutubeUrl('https://example.com/?redirect=youtube.com/watch?v=x')).toBe(false)
    expect(isYoutubeUrl('not a url at all')).toBe(false)
    expect(isYoutubeUrl('')).toBe(false)
  })

  it('rejects plain http (no downgrade to an insecure fetch)', () => {
    expect(isYoutubeUrl('http://youtu.be/dQw4w9WgXcQ')).toBe(false)
  })

  it('rejects a video id that is implausibly short', () => {
    expect(isYoutubeUrl('https://youtu.be/x')).toBe(false)
  })
})
