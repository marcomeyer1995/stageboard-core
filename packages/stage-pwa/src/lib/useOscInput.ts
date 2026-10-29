import { useEffect } from 'react'
import { OscInMessageSchema, type OscInMessage } from 'shared-types'
import { matchOscRule, OSC_INPUT_CAPABILITY } from './oscInput'
import { latestTrackedShow } from './runAction'
import { getStageServerUrl } from './stageServer'
import { pressTrigger, releaseTrigger } from './triggerPress'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { useOscInputRulesStore } from '../store/useOscInputRulesStore'
import { drivesAutomation, useShowStateStore } from '../store/useShowStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/** "Knöpfe belegen" waits for a message: while set, it goes here instead of to the rules. */
export const oscLearn: { capture: ((message: OscInMessage) => void) | null } = { capture: null }

/**
 * OSC as a trigger (#484, docs/23 §4): the Stage-Server receives the controller's messages and
 * pushes them on a stream; the device that drives the show runs the rules - the same press/release
 * logic as pedals and MIDI controllers (triggerPress.ts), with the master's rights. Only that
 * device (and one learning a button) keeps the stream open - one connection, not one per tablet.
 * Mounted once in PlaybackDrivers.
 */
export function useOscInput(): void {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const hasInput = useLogicalDevicesStore((state) => state.devices.some((d) => d.capability === OSC_INPUT_CAPABILITY))
  const drives = useShowStateStore((state) => drivesAutomation(state))
  const learning = useOscInputRulesStore((state) => state.learning)
  const listen = hasInput && (drives || learning)

  useEffect(() => {
    const base = getStageServerUrl()
    if (!listen || !base || !workspaceId || typeof EventSource === 'undefined') return
    const source = new EventSource(`${base}/workspaces/${encodeURIComponent(workspaceId)}/osc-in/stream`)
    source.onmessage = (event: MessageEvent<string>) => {
      let parsed: OscInMessage
      try {
        const result = OscInMessageSchema.safeParse(JSON.parse(event.data))
        if (!result.success) return
        parsed = result.data
      } catch {
        return
      }
      if (oscLearn.capture) {
        oscLearn.capture(parsed)
        return
      }
      // The show as the always-mounted pedal hook keeps it - no per-frame re-render here (#457).
      const show = latestTrackedShow()
      if (!show || !drivesAutomation(useShowStateStore.getState())) return
      const inputs = useLogicalDevicesStore.getState().devices.filter((d) => d.capability === OSC_INPUT_CAPABILITY)
      const docs = useOscInputRulesStore.getState().docs
      for (const input of inputs) {
        const match = matchOscRule(docs.find((d) => d.id === input.id)?.rules ?? [], parsed)
        if (!match) continue
        const id = `osc:${input.id}:${match.rule.id}`
        if (match.edge === 'press') void pressTrigger(id, match.rule.behavior, show)
        else void releaseTrigger(id, match.rule.behavior, show)
        return
      }
    }
    return () => source.close()
  }, [listen, workspaceId])
}
