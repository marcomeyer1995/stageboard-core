import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from 'shared-types'
import { createMockPlaybackPlugin } from './mockPlaybackPlugin.js'

function testContext(): PluginContext {
  return { log: { info: vi.fn(), error: vi.fn() } }
}

describe('mockPlaybackPlugin', () => {
  it('starts with nothing loaded', () => {
    const plugin = createMockPlaybackPlugin()
    plugin.init(testContext())
    expect(plugin.trigger({ type: 'anything' })).toEqual({
      status: 'ok',
      data: { songId: null, isPlaying: false, positionMs: 0 },
    })
  })

  it('loads a song, resetting playback position', () => {
    const plugin = createMockPlaybackPlugin()
    plugin.init(testContext())
    plugin.trigger({ type: 'seek', payload: { positionMs: 5000 } })
    const result = plugin.trigger({ type: 'load', payload: { songId: 'song-1' } })
    expect(result).toEqual({
      status: 'ok',
      data: { songId: 'song-1', isPlaying: false, positionMs: 0 },
    })
  })

  it('ignores play with nothing loaded', () => {
    const plugin = createMockPlaybackPlugin()
    plugin.init(testContext())
    const result = plugin.trigger({ type: 'play' })
    expect(result).toEqual({
      status: 'ok',
      data: { songId: null, isPlaying: false, positionMs: 0 },
    })
  })

  it('plays, pauses and stops a loaded song', () => {
    const plugin = createMockPlaybackPlugin()
    plugin.init(testContext())
    plugin.trigger({ type: 'load', payload: { songId: 'song-1' } })

    expect(plugin.trigger({ type: 'play' })).toEqual({
      status: 'ok',
      data: { songId: 'song-1', isPlaying: true, positionMs: 0 },
    })
    expect(plugin.trigger({ type: 'pause' })).toEqual({
      status: 'ok',
      data: { songId: 'song-1', isPlaying: false, positionMs: 0 },
    })

    plugin.trigger({ type: 'seek', payload: { positionMs: 12000 } })
    expect(plugin.trigger({ type: 'stop' })).toEqual({
      status: 'ok',
      data: { songId: 'song-1', isPlaying: false, positionMs: 0 },
    })
  })

  it('seeks only on a numeric positionMs payload', () => {
    const plugin = createMockPlaybackPlugin()
    plugin.init(testContext())
    plugin.trigger({ type: 'load', payload: { songId: 'song-1' } })
    plugin.trigger({ type: 'seek', payload: { positionMs: 'far' } })
    expect(plugin.trigger({ type: 'anything' })).toEqual({
      status: 'ok',
      data: { songId: 'song-1', isPlaying: false, positionMs: 0 },
    })
  })
})
