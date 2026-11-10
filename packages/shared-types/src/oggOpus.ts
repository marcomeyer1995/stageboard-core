/**
 * The track format is Ogg Opus (docs/30 §8h). Audio that is Opus already - YouTube's best audio
 * stream, the browser's own recordings, stems written as WebM - only changes its container here:
 * the same packets, re-wrapped, nothing decoded or encoded again, so nothing is lost.
 *
 * Plain TypeScript without dependencies: the Stage-Server (YouTube download, stems) and the app
 * use the same code.
 */

// --- WebM (Matroska) ------------------------------------------------------------------------

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Cluster: 0x1f43b675,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  DiscardPadding: 0x75a2,
} as const

/** IDs that start a new element of the Segment: an open-ended Cluster ends where one appears. */
const SEGMENT_CHILDREN = new Set([0x114d9b74, 0x1549a966, ID.Tracks, ID.Cluster, 0x1c53bb6b, 0x1043a770, 0x1254c367, 0x1941a469])

interface Element {
  id: number
  /** Where the content starts and ends (end = Infinity: size unknown, to the parent's end). */
  start: number
  end: number
}

function readId(b: Uint8Array, at: number): { id: number; length: number } | null {
  const first = b[at]
  if (first === undefined || first === 0) return null
  const length = Math.clz32(first) - 23 // leading zeros within the byte, + 1
  if (length > 4 || at + length > b.length) return null
  let id = 0
  for (let i = 0; i < length; i++) id = id * 256 + b[at + i]!
  return { id, length }
}

function readSize(b: Uint8Array, at: number): { size: number; length: number } | null {
  const first = b[at]
  if (first === undefined || first === 0) return null
  const length = Math.clz32(first) - 23
  if (length > 8 || at + length > b.length) return null
  let size = first & (0xff >> length)
  let allOnes = size === 0xff >> length
  for (let i = 1; i < length; i++) {
    const v = b[at + i]!
    allOnes &&= v === 0xff
    size = size * 256 + v
  }
  return { size: allOnes ? Infinity : size, length }
}

function readElement(b: Uint8Array, at: number, parentEnd: number): Element | null {
  const id = readId(b, at)
  if (!id) return null
  const size = readSize(b, at + id.length)
  if (!size) return null
  const start = at + id.length + size.length
  const end = size.size === Infinity ? parentEnd : start + size.size
  if (end > parentEnd || end > b.length) return null
  return { id: id.id, start, end: size.size === Infinity ? Infinity : end }
}

function uint(b: Uint8Array, e: Element): number {
  let v = 0
  for (let i = e.start; i < e.end; i++) v = v * 256 + b[i]!
  return v
}

function sint(b: Uint8Array, e: Element): number {
  const n = e.end - e.start
  if (n === 0) return 0
  const v = uint(b, e)
  return v >= 2 ** (8 * n - 1) ? v - 2 ** (8 * n) : v
}

/** Opus packets of a WebM file's Opus track, with what the container says about the end. */
interface WebmOpus {
  head: Uint8Array
  packets: Uint8Array[]
  /** Samples (48 kHz) dropped at the end: the last block's DiscardPadding. */
  discardEnd: number
}

function webmOpus(b: Uint8Array): WebmOpus | null {
  let at = 0
  let segment: Element | null = null
  while (at < b.length) {
    const e = readElement(b, at, b.length)
    if (!e) return null
    if (e.id === ID.Segment) {
      segment = e
      break
    }
    if (e.end === Infinity) return null
    at = e.end
  }
  if (!segment) return null
  const segEnd = Math.min(segment.end, b.length)
  let track = -1
  let head: Uint8Array | null = null
  const packets: Uint8Array[] = []
  let discardEnd = 0
  let lastDiscard = 0

  const block = (data: Element, discardNs: number) => {
    const t = readSize(b, data.start) // track number, a size-like varint
    if (!t || t.size !== track) return true
    const flags = b[data.start + t.length + 2]!
    if ((flags & 0x06) !== 0) return false // laced: not written by YouTube, browsers or PyAV - no
    packets.push(b.subarray(data.start + t.length + 3, data.end))
    lastDiscard = discardNs
    return true
  }

  at = segment.start
  while (at < segEnd) {
    const e = readElement(b, at, segEnd)
    if (!e) break
    const end = Math.min(e.end, segEnd)
    if (e.id === ID.Tracks) {
      for (let c = e.start; c < end; ) {
        const entry = readElement(b, c, end)
        if (!entry || entry.end === Infinity) break
        if (entry.id === ID.TrackEntry && track < 0) {
          let number = -1
          let codec = ''
          let priv: Uint8Array | null = null
          for (let d = entry.start; d < entry.end; ) {
            const f = readElement(b, d, entry.end)
            if (!f || f.end === Infinity) break
            if (f.id === ID.TrackNumber) number = uint(b, f)
            if (f.id === ID.CodecID) codec = String.fromCharCode(...b.subarray(f.start, f.end))
            if (f.id === ID.CodecPrivate) priv = b.subarray(f.start, f.end)
            d = f.end
          }
          if (codec === 'A_OPUS' && priv) {
            track = number
            head = priv
          }
        }
        c = entry.end
      }
    } else if (e.id === ID.Cluster) {
      let c = e.start
      while (c < end) {
        const id = readId(b, c)
        if (!id || SEGMENT_CHILDREN.has(id.id)) break // an open-ended cluster ends here
        const f = readElement(b, c, end)
        if (!f || f.end === Infinity) return null
        if (f.id === ID.SimpleBlock) {
          if (!block(f, 0)) return null
        } else if (f.id === ID.BlockGroup) {
          let data: Element | null = null
          let discardNs = 0
          for (let d = f.start; d < f.end; ) {
            const g = readElement(b, d, f.end)
            if (!g || g.end === Infinity) break
            if (g.id === ID.Block) data = g
            if (g.id === ID.DiscardPadding) discardNs = sint(b, g)
            d = g.end
          }
          if (data && !block(data, discardNs)) return null
        }
        c = f.end
      }
      at = c
      continue
    }
    if (e.end === Infinity) break
    at = e.end
  }
  if (!head || packets.length === 0) return null
  discardEnd = Math.max(0, Math.round((lastDiscard * 48000) / 1e9))
  return { head, packets, discardEnd }
}

// --- Opus ---------------------------------------------------------------------------------------

/** Samples (48 kHz) one Opus packet holds, from its TOC byte (RFC 6716 §3.1); 0 if malformed. */
export function opusPacketSamples(packet: Uint8Array): number {
  const toc = packet[0]
  if (toc === undefined) return 0
  const config = toc >> 3
  const frame = config < 12 ? [480, 960, 1920, 2880][config & 3]! : config < 16 ? [480, 960][config & 1]! : [120, 240, 480, 960][config & 3]!
  const code = toc & 3
  const frames = code === 0 ? 1 : code < 3 ? 2 : (packet[1] ?? 0) & 0x3f
  const samples = frame * frames
  return samples > 5760 ? 0 : samples // never more than 120 ms
}

// --- Ogg ----------------------------------------------------------------------------------------

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let r = i << 24
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1
    t[i] = r >>> 0
  }
  return t
})()

function crc(b: Uint8Array): number {
  let c = 0
  for (let i = 0; i < b.length; i++) c = ((c << 8) ^ CRC[((c >>> 24) ^ b[i]!) & 0xff]!) >>> 0
  return c
}

/** Packets per page: a second of audio, as the native writer (opus_writer.cpp). */
const PACKETS_PER_PAGE = 50

class OggPages {
  private pages: Uint8Array[] = []
  private sequence = 0
  constructor(private readonly serial: number) {}

  page(packets: Uint8Array[], granule: number, flags: number): void {
    const lacing: number[] = []
    for (const p of packets) {
      for (let left = p.length; left >= 0; left -= 255) lacing.push(Math.min(left, 255))
    }
    const body = packets.reduce((n, p) => n + p.length, 0)
    const out = new Uint8Array(27 + lacing.length + body)
    const v = new DataView(out.buffer)
    out.set([0x4f, 0x67, 0x67, 0x53, 0, flags])
    v.setBigInt64(6, BigInt(granule), true)
    v.setUint32(14, this.serial, true)
    v.setUint32(18, this.sequence++, true)
    out[26] = lacing.length
    out.set(lacing, 27)
    let at = 27 + lacing.length
    for (const p of packets) {
      out.set(p, at)
      at += p.length
    }
    v.setUint32(22, crc(out), true)
    this.pages.push(out)
  }

  file(): Uint8Array {
    const out = new Uint8Array(this.pages.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of this.pages) {
      out.set(p, at)
      at += p.length
    }
    return out
  }
}

/**
 * A WebM file with an Opus track → the same audio as Ogg Opus, packet for packet. Null when it
 * isn't one (no Opus track, laced blocks, damaged): the caller keeps the original then, or
 * encodes it anew.
 */
export function webmOpusToOgg(webm: Uint8Array): Uint8Array | null {
  const opus = webmOpus(webm)
  if (!opus) return null
  const { head, packets } = opus
  if (head.length < 19 || String.fromCharCode(...head.subarray(0, 8)) !== 'OpusHead' || head[18] !== 0) return null
  const preSkip = head[10]! | (head[11]! << 8)
  const pages = new OggPages(0x53426f72) // "SBor"
  pages.page([head], 0, 0x02)
  const vendor = new TextEncoder().encode('StageBoard (umgepackt, nicht neu kodiert)')
  const tags = new Uint8Array(8 + 4 + vendor.length + 4)
  tags.set(new TextEncoder().encode('OpusTags'))
  new DataView(tags.buffer).setUint32(8, vendor.length, true)
  tags.set(vendor, 12)
  pages.page([tags], 0, 0)
  let samples = 0
  const total = packets.reduce((n, p) => n + opusPacketSamples(p), 0)
  if (packets.some((p) => opusPacketSamples(p) === 0)) return null
  // Granule positions count the pre-skip; the end is what the container dropped (DiscardPadding).
  const end = total - opus.discardEnd
  if (end < preSkip) return null
  for (let i = 0; i < packets.length; i += PACKETS_PER_PAGE) {
    const group = packets.slice(i, i + PACKETS_PER_PAGE)
    for (const p of group) samples += opusPacketSamples(p)
    const last = i + PACKETS_PER_PAGE >= packets.length
    pages.page(group, last ? end : samples, last ? 0x04 : 0)
  }
  return pages.file()
}

/** Pre-skip, channels and playable frames (48 kHz) of an Ogg Opus file - null if it isn't one. */
export function oggOpusInfo(ogg: Uint8Array): { channels: number; preSkip: number; frames: number } | null {
  const v = new DataView(ogg.buffer, ogg.byteOffset, ogg.byteLength)
  let at = 0
  let channels = 0
  let preSkip = 0
  let granule = -1
  while (at + 27 <= ogg.length) {
    if (v.getUint32(at) !== 0x4f676753) return null
    const segments = ogg[at + 26]!
    let body = 0
    for (let s = 0; s < segments; s++) body += ogg[at + 27 + s]!
    const length = 27 + segments + body
    if (at + length > ogg.length) return null
    const page = ogg.slice(at, at + length)
    new DataView(page.buffer).setUint32(22, 0, true)
    if (crc(page) !== v.getUint32(at + 22, true)) return null
    if (at === 0) {
      const head = ogg.subarray(at + 27 + segments)
      if (String.fromCharCode(...head.subarray(0, 8)) !== 'OpusHead') return null
      channels = head[9]!
      preSkip = head[10]! | (head[11]! << 8)
    }
    const g = Number(v.getBigInt64(at + 6, true))
    if (g !== -1) granule = g
    at += length
  }
  return at === ogg.length && granule >= preSkip ? { channels, preSkip, frames: granule - preSkip } : null
}
