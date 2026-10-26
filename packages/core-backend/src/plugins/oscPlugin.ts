import { createSocket, type Socket } from 'node:dgram'
import { DeviceTransportConfigSchema, type IShowControlPlugin, type PluginContext, type ShowControlEvent, type ShowControlResult } from 'shared-types'

/**
 * Generic OSC sender (#484): cues to lighting and video software (QLC+, Resolume, ProPresenter,
 * grandMA onPC …) go out from the Stage-Server as UDP - a browser can't send UDP. The master
 * triggers it like every server cue; the gateway holds it until `scheduledAt` (index.ts), so it
 * leaves on time. Where to send is the device's own setting (Bühnentechnik → Netzwerk (OSC): host
 * and port), not the cue's: a new lighting PC changes one device, not every song.
 */

export const OSC_PLUGIN_ID = 'osc'
export const OSC_SEND = 'osc.send'

export interface OscTarget {
  host: string
  port: number
}

export type OscArg = { type: 'i'; value: number } | { type: 'f'; value: number } | { type: 's'; value: string } | { type: 'T' } | { type: 'F' }

/** Host and port from a device's transport config (Bühnentechnik → Netzwerk (OSC)); null when a
 * value is missing or makes no sense. */
export function oscTargetFromConfig(doc: unknown): OscTarget | null {
  const parsed = DeviceTransportConfigSchema.safeParse(doc)
  if (!parsed.success) return null
  const host = parsed.data.values.host?.trim()
  const port = Number(parsed.data.values.port)
  return host && Number.isInteger(port) && port > 0 && port < 65536 ? { host, port } : null
}

/** Where a device's OSC goes - set by index.ts (the device's transport config in the active band). */
type TargetResolver = (logicalDeviceId: string | undefined) => Promise<OscTarget | null>
let resolveTarget: TargetResolver = async () => null

export function setOscTargetResolver(resolver: TargetResolver): void {
  resolveTarget = resolver
}

/**
 * The cue's values as typed OSC arguments: `1` → int, `0.5` → float, `true`/`false` → T/F,
 * anything else (or "in quotes") → string. Several, separated by spaces - BandHelper allows only one.
 */
export function parseOscArgs(text: string): OscArg[] {
  const tokens = text.match(/"[^"]*"|\S+/g) ?? []
  return tokens.map((token): OscArg => {
    if (token.startsWith('"') && token.endsWith('"') && token.length >= 2) return { type: 's', value: token.slice(1, -1) }
    if (/^-?\d+$/.test(token) && Math.abs(Number(token)) <= 2 ** 31 - 1) return { type: 'i', value: Number(token) }
    if (/^-?(\d+\.\d*|\.\d+|\d+)(e-?\d+)?$/i.test(token.replace(',', '.'))) return { type: 'f', value: Number(token.replace(',', '.')) }
    if (token === 'true') return { type: 'T' }
    if (token === 'false') return { type: 'F' }
    return { type: 's', value: token }
  })
}

/** An OSC string: UTF-8, NUL-terminated, padded to a multiple of 4 bytes. */
function oscString(s: string): Buffer {
  const bytes = Buffer.from(s, 'utf8')
  const padded = Buffer.alloc(Math.ceil((bytes.length + 1) / 4) * 4)
  bytes.copy(padded)
  return padded
}

/** One OSC 1.0 message: address, type tags, arguments (big-endian). */
export function encodeOscMessage(address: string, args: readonly OscArg[]): Buffer {
  const parts: Buffer[] = [oscString(address), oscString(`,${args.map((a) => a.type).join('')}`)]
  for (const arg of args) {
    if (arg.type === 'i') {
      const b = Buffer.alloc(4)
      b.writeInt32BE(arg.value)
      parts.push(b)
    } else if (arg.type === 'f') {
      const b = Buffer.alloc(4)
      b.writeFloatBE(arg.value)
      parts.push(b)
    } else if (arg.type === 's') parts.push(oscString(arg.value))
  }
  return Buffer.concat(parts)
}

/** An OSC address: starts with "/", no spaces or characters OSC reserves for patterns. */
export function isOscAddress(address: string): boolean {
  return /^\/[^\s#*,?[\]{}]*$/.test(address)
}

export function createOscPlugin(): IShowControlPlugin {
  let context: PluginContext | undefined
  let socket: Socket | null = null

  const send = (message: Buffer, target: OscTarget) =>
    new Promise<void>((resolve, reject) => {
      socket ??= createSocket('udp4')
      socket.send(message, target.port, target.host, (err) => (err ? reject(err) : resolve()))
    })

  return {
    name: OSC_PLUGIN_ID,
    version: '0.1.0',
    capabilities: [OSC_PLUGIN_ID],
    init(ctx: PluginContext) {
      context = ctx
    },
    shutdown() {
      socket?.close()
      socket = null
    },
    async trigger(event: ShowControlEvent): Promise<ShowControlResult> {
      if (event.type !== OSC_SEND) return { status: 'error', message: `Unbekannter OSC-Befehl: ${event.type}` }
      const address = typeof event.payload?.address === 'string' ? event.payload.address.trim() : ''
      if (!isOscAddress(address)) return { status: 'error', message: `Keine gültige OSC-Adresse: „${address}“` }
      const target = await resolveTarget(event.logicalDeviceId).catch(() => null)
      if (!target) return { status: 'error', message: 'Für dieses OSC-Gerät fehlen Host und Port (Bühnentechnik).' }
      const args = parseOscArgs(typeof event.payload?.args === 'string' ? event.payload.args : '')
      try {
        await send(encodeOscMessage(address, args), target)
        context?.log.info('osc sent', { address, args: args.length, host: target.host, port: target.port })
        return { status: 'ok' }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        context?.log.error('osc send failed', { address, host: target.host, port: target.port, error: message })
        return { status: 'error', message: `OSC an ${target.host}:${target.port} fehlgeschlagen: ${message}` }
      }
    },
  }
}
