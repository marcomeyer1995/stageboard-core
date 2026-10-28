import { useEffect, useRef } from 'react'
import { CAPABILITIES, type DeviceTransportConfig, type LogicalDevice } from 'shared-types'
import { getDeviceId } from './deviceId'
import { decodeMidiButton, matchMidiRule, type MidiButtonEvent, type MidiControllerRulesDoc } from './midiControllerRules'
import { useShowModeOnDemand } from './showMode'
import { pressTrigger, releaseTrigger } from './triggerPress'
import { claimedMidiInputs } from './webMidi'
import { getMidiAccess } from './webMidiOutput'
import { useDeviceTransportConfigStore } from '../store/useDeviceTransportConfigStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { useMidiControllerRulesStore } from '../store/useMidiControllerRulesStore'

/** "Knöpfe belegen" waits for a button: while set, a press goes here instead of to the rules. */
export const midiLearn: { capture: ((logicalDeviceId: string, event: MidiButtonEvent) => void) | null } = { capture: null }

/** The MIDI-Controller devices plugged into this device. */
export function myMidiControllers(devices: readonly LogicalDevice[], deviceId = getDeviceId()): LogicalDevice[] {
  return devices.filter((d) => d.capability === CAPABILITIES.midiController && d.executionTarget === deviceId)
}

/** The input a controller is set to here - by its stored id, else by the name stored next to it
 * (Android hands out new port ids after a replug). */
function resolveInput(access: MIDIAccess, logicalDeviceId: string, configs: readonly DeviceTransportConfig[]): MIDIInput | null {
  const config = configs.find((c) => c.deviceId === getDeviceId() && c.logicalDeviceId === logicalDeviceId)
  const id = config?.values.midiInputId
  if (!id) return null
  const byId = access.inputs.get(id)
  if (byId) return byId
  const name = config.values.midiInputIdName
  return name ? ([...access.inputs.values()].find((input) => input.name === name) ?? null) : null
}

/**
 * MIDI controllers as triggers (#547 step 2, docs/23 §7): listens on the inputs of the
 * controllers plugged into this tablet and runs their button rules - the same press/release logic
 * as pedal keys and widget buttons (triggerPress.ts), the same rights (runAction.ts). Mounted once
 * in PlaybackDrivers; re-attaches when a controller, its port or its rules change, and when a
 * port is plugged in again.
 */
export function useMidiControllers(): void {
  // The clock only at a press (#457) - not a re-render on every frame.
  const show = useShowModeOnDemand()
  const latest = useRef(show)
  latest.current = show
  const devices = useLogicalDevicesStore((state) => state.devices)
  const configs = useDeviceTransportConfigStore((state) => state.configs)
  const docs = useMidiControllerRulesStore((state) => state.docs)

  useEffect(() => {
    const controllers = myMidiControllers(devices)
    if (controllers.length === 0) return
    let cancelled = false
    let detach: (() => void) | null = null
    let access: MIDIAccess | null = null

    const rulesOf = (id: string): MidiControllerRulesDoc['rules'] => docs.find((d) => d.id === id)?.rules ?? []
    const attach = () => {
      detach?.()
      if (!access) return
      const attached: { input: MIDIInput; handler: (event: MIDIMessageEvent) => void }[] = []
      for (const controller of controllers) {
        const input = resolveInput(access, controller.id, configs)
        if (!input) continue
        const handler = (message: MIDIMessageEvent) => {
          const event = decodeMidiButton(message.data ? Array.from(message.data) : [])
          if (!event) return
          if (midiLearn.capture) {
            if (event.edge === 'press') midiLearn.capture(controller.id, event)
            return
          }
          const match = matchMidiRule(rulesOf(controller.id), event)
          if (!match) return
          const id = `midi:${controller.id}:${match.rule.id}`
          if (match.edge === 'press') void pressTrigger(id, match.rule.behavior, latest.current)
          else void releaseTrigger(id, match.rule.behavior, latest.current)
        }
        input.addEventListener('midimessage', handler)
        claimedMidiInputs.add(input.id)
        attached.push({ input, handler })
      }
      detach = () => {
        for (const { input, handler } of attached) {
          input.removeEventListener('midimessage', handler)
          claimedMidiInputs.delete(input.id)
        }
        detach = null
      }
    }

    void getMidiAccess().then((result) => {
      if (cancelled || !result) return
      access = result
      attach()
      access.addEventListener('statechange', attach)
    })
    return () => {
      cancelled = true
      access?.removeEventListener('statechange', attach)
      detach?.()
    }
  }, [devices, configs, docs])
}
