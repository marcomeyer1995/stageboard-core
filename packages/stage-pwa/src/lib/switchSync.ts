import { useEffect, useRef } from 'react'
import { SwitchStateEventSchema, type SwitchStateEvent } from 'shared-types'
import { getServerTime } from './clockSync'
import { getDeviceId } from './deviceId'
import { useShowModeOnDemand } from './showMode'
import { getStageServerUrl } from './stageServer'
import { applyRemoteSwitchEvent, expireRemoteHolders, resetTriggerState, setSwitchPublisher, switchesHeldHere } from './triggerPress'
import { drivesAutomation, useShowStateStore } from '../store/useShowStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/** How often a held switch says "still held" - well inside the 3 s after which others let go. */
export const HEARTBEAT_MS = 1_000

function url(workspaceId: string, path: string): string | null {
  const base = getStageServerUrl()
  return base && workspaceId ? `${base}/workspaces/${encodeURIComponent(workspaceId)}/switch-state/${path}` : null
}

function send(workspaceId: string, event: SwitchStateEvent): void {
  const target = url(workspaceId, 'push')
  const workspace = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
  if (!target || !workspace?.username || !workspace.couchPassword) return
  void fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${btoa(`${workspace.username}:${workspace.couchPassword}`)}` },
    body: JSON.stringify(event),
  }).catch(() => {})
}

/**
 * Switch states for the whole band (docs/23 §11.5): this tablet's presses go to the Stage-Server,
 * the other tablets' come back over its stream - so a button lights up everywhere while the blinder
 * is held, wherever it was pressed. Held switches repeat "held" every second; a tablet that went
 * silent counts as released after 3 s, and the device running the show then sends the release
 * action. Without a Stage-Server, switches simply stay per tablet. Mounted once (PlaybackDrivers).
 */
export function useSwitchSync(): void {
  // The clock only at a press (#457) - not a re-render on every frame.
  const show = useShowModeOnDemand()
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const latest = useRef(show)
  latest.current = show

  useEffect(() => {
    if (!workspaceId) return
    const deviceId = getDeviceId()
    resetTriggerState()
    setSwitchPublisher((switchId, kind) => send(workspaceId, { deviceId, switchId, kind, at: getServerTime() }))

    const streamUrl = url(workspaceId, 'stream')
    const source = streamUrl && typeof EventSource !== 'undefined' ? new EventSource(streamUrl) : null
    if (source) {
      source.onmessage = (message) => {
        try {
          const event = SwitchStateEventSchema.parse(JSON.parse(message.data as string))
          if (event.deviceId !== deviceId) applyRemoteSwitchEvent(event.switchId, event.deviceId, event.kind)
        } catch {
          // A malformed event is skipped; the next change or heartbeat brings the state again.
        }
      }
    }
    const tick = setInterval(() => {
      for (const switchId of switchesHeldHere()) send(workspaceId, { deviceId, switchId, kind: 'held', at: getServerTime() })
      expireRemoteHolders(latest.current, drivesAutomation(useShowStateStore.getState()))
    }, HEARTBEAT_MS)
    return () => {
      source?.close()
      clearInterval(tick)
      setSwitchPublisher(() => {})
    }
  }, [workspaceId])
}
