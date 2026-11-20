import { describe, expect, it } from 'vitest'
import {
  ADDON_CONTRACT_VERSION,
  AddonErrorSchema,
  ContributesSchema,
  DeviceContributionSchema,
  EnvelopeSchema,
  JsonSchema,
  SlotIdSchema,
  StateFieldSchema,
  parseContributes,
  type Envelope,
} from './addonContract.js'

describe('EnvelopeSchema (#964)', () => {
  it('accepts one valid message of each of the eight shapes', () => {
    const valid: Envelope[] = [
      { kind: 'request', id: 1, method: 'songs.list', body: { limit: 10 } },
      { kind: 'response', id: 1, ok: true, body: { songs: [] } },
      { kind: 'response', id: 2, ok: false, error: { code: 'songs.not-found', message: 'No such song' } },
      { kind: 'notify', topic: 'job.progress', body: { id: 'job-1', fraction: 0.5 } },
      { kind: 'subscribe', id: 3, stream: 'device:qlc-plus.scene' },
      { kind: 'update', id: 3, body: { scene: 'a' } },
      { kind: 'ui-set', slot: 'song-editor.track-source', tree: { type: 'dialog', children: [] } },
      { kind: 'ui-action', slot: 'song-editor.track-source', action: 'search', value: 'some song' },
    ]

    for (const message of valid) {
      expect(EnvelopeSchema.safeParse(message).success, message.kind).toBe(true)
    }
  })

  it('accepts a ui-action without a value', () => {
    expect(EnvelopeSchema.safeParse({ kind: 'ui-action', slot: 'toolbar.action', action: 'open' }).success).toBe(true)
  })

  it('rejects a request whose id is a string', () => {
    expect(EnvelopeSchema.safeParse({ kind: 'request', id: '1' }).success).toBe(false)
  })

  it('rejects an unknown kind', () => {
    expect(EnvelopeSchema.safeParse({ kind: 'teleport', id: 1 }).success).toBe(false)
  })

  it('rejects a response that carries both ok: true and an error', () => {
    const both = { kind: 'response', id: 1, ok: true, body: {}, error: { code: 'boom', message: 'Both at once' } }
    expect(EnvelopeSchema.safeParse(both).success).toBe(false)
  })

  it('rejects a failed response without an error', () => {
    expect(EnvelopeSchema.safeParse({ kind: 'response', id: 1, ok: false }).success).toBe(false)
  })

  it('rejects fields the contract does not know', () => {
    expect(EnvelopeSchema.safeParse({ kind: 'notify', topic: 'log', body: {}, extra: true }).success).toBe(false)
  })

  it('is the contract version the manifest declares', () => {
    expect(ADDON_CONTRACT_VERSION).toBe(3)
  })
})

describe('AddonErrorSchema (#964)', () => {
  it('accepts a code and message with optional params', () => {
    expect(AddonErrorSchema.safeParse({ code: 'http.denied', message: 'Not allowed' }).success).toBe(true)
    expect(AddonErrorSchema.safeParse({ code: 'http.denied', message: 'Not allowed', params: { origin: 'https://x.test', status: 403 } }).success).toBe(true)
  })

  it('rejects an empty code', () => {
    expect(AddonErrorSchema.safeParse({ code: '', message: 'No code' }).success).toBe(false)
  })

  it('rejects params that are neither strings nor numbers', () => {
    expect(AddonErrorSchema.safeParse({ code: 'x', message: 'y', params: { nested: { a: 1 } } }).success).toBe(false)
  })
})

/** The contributions of the YouTube add-on as docs/36 §3 and §7 sketch them. */
const youtubeContributes = {
  methods: {
    search: { in: { type: 'object', properties: { query: { type: 'string' } } }, out: { type: 'object' } },
    import: { in: { type: 'object' }, out: { type: 'object' } },
  },
  jobs: { 'youtube-extract': { input: { type: 'object' }, needs: { helper: 'yt-dlp' } } },
  ui: [{ slot: 'song-editor.track-source', id: 'yt', title: 'From YouTube', icon: 'youtube' }],
  settings: { type: 'object', properties: { quality: { type: 'string' } } },
}

describe('SlotIdSchema (#964)', () => {
  it('is exactly the slots docs/36 §6 defines - slots are API, the core owns them', () => {
    expect(SlotIdSchema.options).toEqual([
      'song-editor.track-source',
      'song-editor.panel',
      'device.panel',
      'settings.section',
      'lookup.source',
      'toolbar.action',
    ])
  })

  it('rejects a slot the core does not know', () => {
    expect(SlotIdSchema.safeParse('song-editor.sidebar').success).toBe(false)
    expect(SlotIdSchema.safeParse('').success).toBe(false)
  })
})

describe('JsonSchema (#964)', () => {
  it('is an object schema - the developer declares it in the manifest, the boundary checks it at call time', () => {
    expect(JsonSchema.safeParse({ type: 'object', properties: { q: { type: 'string' } } }).success).toBe(true)
    expect(JsonSchema.safeParse({ type: 'object', additionalProperties: false }).success).toBe(true)
  })

  it('rejects what is not an object schema', () => {
    for (const bad of [[], 'object', 42, null]) expect(JsonSchema.safeParse(bad).success, String(bad)).toBe(false)
  })
})

describe('StateFieldSchema and DeviceContributionSchema (#964, docs/36 §5a)', () => {
  it('accepts the QLC+ state fields from the spec', () => {
    expect(StateFieldSchema.safeParse({ type: 'enum', values: ['a', 'b'] }).success).toBe(true)
    expect(StateFieldSchema.safeParse({ type: 'number', min: 0, max: 1 }).success).toBe(true)
  })

  it('rejects an enum without values and an unknown field type', () => {
    expect(StateFieldSchema.safeParse({ type: 'enum' }).success).toBe(false)
    expect(StateFieldSchema.safeParse({ type: 'hologram' }).success).toBe(false)
  })

  it('a device declares kind, title, transport, state and commands', () => {
    const device = {
      kind: 'qlc-plus',
      title: 'QLC+',
      transport: 'network-osc',
      state: { scene: { type: 'enum', values: ['a', 'b'] }, level: { type: 'number', min: 0, max: 1 } },
      commands: { setScene: { in: { type: 'object' } } },
    }
    expect(DeviceContributionSchema.safeParse(device).success).toBe(true)
    expect(DeviceContributionSchema.safeParse({ ...device, kind: '' }).success).toBe(false)
  })
})

describe('parseContributes (#964, docs/36 §3)', () => {
  it('parses a YouTube-like manifest and fills the kinds it does not declare', () => {
    const { contributes, unknown } = parseContributes(youtubeContributes)

    expect(unknown).toEqual([])
    expect(contributes.methods.search?.in).toEqual({ type: 'object', properties: { query: { type: 'string' } } })
    expect(contributes.jobs['youtube-extract']).toEqual({ input: { type: 'object' }, needs: { helper: 'yt-dlp' } })
    expect(contributes.ui).toEqual([{ slot: 'song-editor.track-source', id: 'yt', title: 'From YouTube', icon: 'youtube' }])
    expect(contributes.settings).toEqual({ type: 'object', properties: { quality: { type: 'string' } } })
    expect(contributes.devices).toEqual([])
  })

  it('returns unknown top-level keys in `unknown`, never an error, and parses the rest', () => {
    const { contributes, unknown } = parseContributes({ ...youtubeContributes, holograms: { projector: true } })

    expect(unknown).toEqual(['holograms'])
    expect(contributes.ui[0]?.title).toBe('From YouTube')
    expect((contributes as Record<string, unknown>).holograms).toBeUndefined()
  })

  it('a manifest that only contributes something unknown yields empty defaults and the key', () => {
    const { contributes, unknown } = parseContributes({ holograms: true })

    expect(unknown).toEqual(['holograms'])
    expect(contributes.methods).toEqual({})
    expect(contributes.jobs).toEqual({})
    expect(contributes.devices).toEqual([])
    expect(contributes.ui).toEqual([])
  })

  it('rejects an unknown slot - a slot is a StageBoard change, not an add-on choice', () => {
    const withUnknownSlot = { ui: [{ slot: 'song-editor.sidebar', id: 'x', title: 'Sidebar' }] }

    expect(() => parseContributes(withUnknownSlot)).toThrow()
    expect(ContributesSchema.safeParse(withUnknownSlot).success).toBe(false)
  })

  it('rejects a contribution whose declared shape is wrong', () => {
    expect(ContributesSchema.safeParse({ methods: { search: { in: { type: 'object' } } } }).success).toBe(false)
    expect(ContributesSchema.safeParse({ ui: [{ id: 'yt', title: 'No slot' }] }).success).toBe(false)
  })

  it('treats an absent `contributes` as nothing contributed and rejects a non-object', () => {
    expect(parseContributes(undefined)).toEqual({ contributes: ContributesSchema.parse({}), unknown: [] })
    for (const bad of [[], 'ui', 42]) expect(() => parseContributes(bad), String(bad)).toThrow()
  })
})
