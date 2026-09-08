import type { ShowControlResult } from 'shared-types'
import { getDeviceId } from './deviceId'
import type { Translator } from './clientTranslator'
import { dbToFaderValue } from './ui24rCurves'
import { getUi24rConnection, sendUi24r, type Ui24rConnection } from './ui24rSocket'
import { useDeviceTransportConfigStore } from '../store/useDeviceTransportConfigStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'

/**
 * A real, installable plugin (pluginCatalog.ts) rather than a mock. Own dedicated
 * capability, NOT `CAPABILITIES.mixer` even though this is a real mixer, same as
 * cq18tTranslator.ts - `clientTranslator.ts`'s `TRANSLATORS` map holds exactly one
 * Translator per capability globally, and that slot is already `useLocalMixerStore`'s
 * fixed mock, not plugin-swappable (see cq18tTranslator.ts's own doc comment, which hit
 * this exact issue first).
 *
 * Transport is WebSocket, not WebMIDI/WebUSB - `hardwareIds: []` in the catalog entry
 * (nothing to auto-detect), manual "IP-Adresse"/"Port" entry only via the wizard's Step 3
 * fallback. `ws://` is unencrypted; connecting to it from an HTTPS-served PWA may hit
 * mixed-content blocking in some browsers/deployments - a real, documented limitation of
 * the real device's own protocol (docs/protocol-notes.md), not something this plugin can
 * route around.
 */
export const UI24R_CAPABILITY = 'ui24r-control'

/** Per-channel-type slot counts on the Ui24R specifically (protocol-notes.md's "Channel
 * types and counts" table, ported from the reference library's `device-capabilities.ts`
 * `ui24` entry) - used only to validate a caller's channel number against real hardware's
 * range. `mix` (fader) and `mute` are the two properties the docs confirm exist on every
 * one of these 7 types, so no type is excluded here the way e.g. `name`/`pan` exclude `v`
 * (VCAs) elsewhere in the protocol. */
const CHANNEL_COUNTS: Record<string, number> = { i: 24, l: 2, p: 2, f: 4, s: 6, a: 10, v: 6 }

interface Ui24rTarget {
  connection: Ui24rConnection
}

/** Same "first Logical Device with this capability, bound on this device" resolution as
 * kemperTranslator.ts/cq18tTranslator.ts/mg30Translator.ts/rc500Translator.ts - see their
 * own doc comments for why. */
async function resolveUi24r(): Promise<Ui24rTarget | null> {
  const logicalDevice = useLogicalDevicesStore.getState().devices.find((d) => d.capability === UI24R_CAPABILITY)
  if (!logicalDevice) return null

  const deviceId = getDeviceId()
  const config = useDeviceTransportConfigStore
    .getState()
    .configs.find((c) => c.deviceId === deviceId && c.logicalDeviceId === logicalDevice.id)
  const host = config?.values.host
  const port = Number(config?.values.port)
  if (!host || !Number.isInteger(port)) return null

  try {
    return { connection: await getUi24rConnection(host, port) }
  } catch {
    return null
  }
}

function channelPath(channelType: string, channel: number, property: string): string | null {
  const count = CHANNEL_COUNTS[channelType]
  if (!count || !Number.isInteger(channel) || channel < 1 || channel > count) return null
  return `${channelType}.${channel - 1}.${property}`
}

function setLevel(ui24r: Ui24rTarget, payload: Record<string, unknown> | undefined): ShowControlResult {
  const channelType = String(payload?.channelType ?? '')
  const channel = Number(payload?.channel)
  const db = Number(payload?.db)
  const path = channelPath(channelType, channel, 'mix')
  if (!path) return { status: 'error', message: `ui24r.setLevel: unbekannter Kanal "${channelType}.${channel}".` }
  if (Number.isNaN(db)) return { status: 'error', message: 'ui24r.setLevel: db muss eine Zahl sein.' }
  sendUi24r(ui24r.connection, path, dbToFaderValue(db))
  return { status: 'ok', data: { channelType, channel, db } }
}

function setMute(ui24r: Ui24rTarget, payload: Record<string, unknown> | undefined): ShowControlResult {
  const channelType = String(payload?.channelType ?? '')
  const channel = Number(payload?.channel)
  const mute = payload?.mute === true
  const path = channelPath(channelType, channel, 'mute')
  if (!path) return { status: 'error', message: `ui24r.setMute: unbekannter Kanal "${channelType}.${channel}".` }
  sendUi24r(ui24r.connection, path, mute ? 1 : 0)
  return { status: 'ok', data: { channelType, channel, mute } }
}

/** No message sent - purely observes whether the already-connected socket's initial
 * state dump has reached the one path every Ui24R always seeds (`model`, protocol-
 * notes.md's "Initial state dump" section). A passive presence check, not a query -
 * matching CQ-18T/MG-30's safety bar that a "test" button clickable at any time must
 * never risk an audible side effect, taken one step further here since the Ui24R offers
 * no query mechanism to send in the first place (unlike CQ-18T's NRPN Get). */
async function test(ui24r: Ui24rTarget): Promise<ShowControlResult> {
  const deadline = Date.now() + 1000
  while (!ui24r.connection.state.has('model') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const model = ui24r.connection.state.get('model')
  if (model === undefined) {
    return { status: 'error', message: 'Ui24R: verbunden, aber kein initialer Status-Dump empfangen.' }
  }
  return { status: 'ok', message: `Verbunden (Modell: ${model})` }
}

export const ui24rTranslator: Translator = async (event) => {
  const ui24r = await resolveUi24r()
  if (!ui24r) return { status: 'error', message: 'Ui24R: keine Verbindung konfiguriert.' }

  switch (event.type) {
    case 'ui24r.setLevel':
      return setLevel(ui24r, event.payload)
    case 'ui24r.setMute':
      return setMute(ui24r, event.payload)
    case 'test':
      return test(ui24r)
    default:
      return { status: 'error', message: `Ui24R: unbekannter Event-Typ "${event.type}".` }
  }
}
