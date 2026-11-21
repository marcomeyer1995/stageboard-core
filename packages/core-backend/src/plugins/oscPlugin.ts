import { DeviceTransportConfigSchema, type OscInMessage } from 'shared-types'

/**
 * Generic OSC sender (#484): cues to lighting and video software (QLC+, Resolume, ProPresenter,
 * grandMA onPC …) go out from the Host as UDP - a browser can't send UDP. The master
 * triggers it like every host cue; the gateway holds it until `scheduledAt` (index.ts), so it
 * leaves on time. Where to send is the device's own setting (Bühnentechnik → Netzwerk (OSC): host
 * and port), not the cue's: a new lighting PC changes one device, not every song.
 */

export const OSC_PLUGIN_ID = 'osc'
export const OSC_SEND = 'osc.send'

export interface OscTarget {
  host: string
  port: number
}

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

/** Where a device's OSC goes, or null (none set, or the lookup failed). */
export const resolveOscTarget = (logicalDeviceId: string | undefined): Promise<OscTarget | null> => resolveTarget(logicalDeviceId).catch(() => null)

export function setOscTargetResolver(resolver: TargetResolver): void {
  resolveTarget = resolver
}

/** Reads an OSC string at `offset`: its text and where the next field starts (4-byte aligned). */
function readOscString(buf: Buffer, offset: number): { value: string; next: number } {
  const end = buf.indexOf(0, offset)
  if (end < 0) throw new Error('unterminated OSC string')
  return { value: buf.toString('utf8', offset, end), next: offset + Math.ceil((end - offset + 1) / 4) * 4 }
}

/**
 * The messages in a received OSC packet (#484, OSC in): one message, or a `#bundle` of them
 * (nested bundles too). Arguments int, float, string, true/false; other types end the message's
 * arguments (rare from controllers, and a trigger only needs the first). A broken packet: none.
 */
export function decodeOscPacket(buf: Buffer): Omit<OscInMessage, 'at'>[] {
  try {
    if (buf.toString('ascii', 0, 8) === '#bundle\0') {
      const out: Omit<OscInMessage, 'at'>[] = []
      let offset = 16 // "#bundle\0" + 8-byte time tag
      while (offset + 4 <= buf.length) {
        const size = buf.readInt32BE(offset)
        offset += 4
        if (size <= 0 || offset + size > buf.length) break
        out.push(...decodeOscPacket(buf.subarray(offset, offset + size)))
        offset += size
      }
      return out
    }
    const address = readOscString(buf, 0)
    if (!address.value.startsWith('/')) return []
    if (address.next >= buf.length) return [{ address: address.value, args: [] }]
    const tags = readOscString(buf, address.next)
    if (!tags.value.startsWith(',')) return [{ address: address.value, args: [] }]
    const args: (number | string | boolean)[] = []
    let offset = tags.next
    for (const tag of tags.value.slice(1)) {
      if (tag === 'i') {
        args.push(buf.readInt32BE(offset))
        offset += 4
      } else if (tag === 'f') {
        args.push(Math.round(buf.readFloatBE(offset) * 1e6) / 1e6)
        offset += 4
      } else if (tag === 's') {
        const s = readOscString(buf, offset)
        args.push(s.value)
        offset = s.next
      } else if (tag === 'T') args.push(true)
      else if (tag === 'F') args.push(false)
      else break
    }
    return [{ address: address.value, args }]
  } catch {
    return []
  }
}
