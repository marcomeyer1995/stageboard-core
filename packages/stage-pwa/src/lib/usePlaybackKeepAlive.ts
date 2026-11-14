import { registerPlugin } from '@capacitor/core'
import { useEffect } from 'react'
import { isNativeApp } from './native'
import { useAppModeStore } from '../store/useAppModeStore'
import { usePracticeStateStore } from '../store/usePracticeStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

interface PlaybackServicePlugin {
  start: () => Promise<void>
  stop: () => Promise<void>
}
const PlaybackService = registerPlugin<PlaybackServicePlugin>('PlaybackService')

/**
 * The app keeps playing with the screen locked (N1, Marco 2026-11-10): an Android foreground
 * service with the notification "StageBoard spielt". On for the whole Gig - also in a pause, so a
 * pushed Play still arrives on time - and in Solo practice while something plays.
 */
export function usePlaybackKeepAlive(): void {
  const gig = useAppModeStore((state) => state.mode === 'gig')
  const practicePlaying = usePracticeStateStore((state) => state.byWorkspace[useWorkspaceStore.getState().activeWorkspaceId]?.playbackStatus === 'playing')
  const wanted = gig || practicePlaying
  useEffect(() => {
    if (!isNativeApp()) return
    // The service outlives a page reload - so not wanting it means stopping it actively.
    if (!wanted) {
      void PlaybackService.stop().catch(() => undefined)
      return
    }
    void PlaybackService.start().catch(() => undefined)
    return () => {
      void PlaybackService.stop().catch(() => undefined)
    }
  }, [wanted])
}
