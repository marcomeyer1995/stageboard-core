import {
  CAPABILITIES,
  type IShowControlPlugin,
  type PluginContext,
  type ShowControlEvent,
  type ShowControlResult,
} from 'shared-types'

interface PlaybackState {
  songId: string | null
  variantId: string | null
  trackId: string | null
  isPlaying: boolean
  positionMs: number
}

/**
 * Hardware-mock per docs/03: stands in for the Stage-Server's real audio-playback engine
 * (docs/01 "Flexible Audio-Routing-Matrix" - internal soundcard, USB interface, or
 * direct-to-mixer). A real implementation swaps the state below for an actual decoder/output
 * stream behind the exact same IShowControlPlugin.trigger() contract.
 */
export function createMockPlaybackPlugin(): IShowControlPlugin {
  let context: PluginContext | undefined
  let state: PlaybackState = { songId: null, variantId: null, trackId: null, isPlaying: false, positionMs: 0 }

  return {
    name: 'mock-playback',
    version: '0.0.1',
    capabilities: [CAPABILITIES.audioPlayback],
    init(ctx: PluginContext) {
      context = ctx
      context.log.info('mock-playback plugin initialized')
    },
    trigger(event: ShowControlEvent): ShowControlResult {
      context?.log.info('mock-playback received trigger', { event })

      switch (event.type) {
        case 'load': {
          const songId = event.payload?.songId
          const variantId = event.payload?.variantId
          const trackId = event.payload?.trackId
          state = {
            songId: typeof songId === 'string' ? songId : null,
            variantId: typeof variantId === 'string' ? variantId : null,
            trackId: typeof trackId === 'string' ? trackId : null,
            isPlaying: false,
            positionMs: 0,
          }
          break
        }
        case 'play':
          if (state.songId) state = { ...state, isPlaying: true }
          break
        case 'pause':
          state = { ...state, isPlaying: false }
          break
        case 'stop':
          state = { ...state, isPlaying: false, positionMs: 0 }
          break
        case 'seek': {
          const positionMs = event.payload?.positionMs
          if (typeof positionMs === 'number') state = { ...state, positionMs }
          break
        }
        default:
          break
      }

      return { status: 'ok', data: { ...state } }
    },
  }
}
