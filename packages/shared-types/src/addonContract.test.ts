import { describe, expect, it } from 'vitest'
import { ADDON_CONTRACT_VERSION, AddonErrorSchema, EnvelopeSchema, type Envelope } from './addonContract.js'

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
