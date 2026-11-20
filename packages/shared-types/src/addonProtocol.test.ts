import { describe, expect, it } from 'vitest'
import type { Envelope } from './addonContract.js'
import { fromEnvelope, toEnvelope, type FromAddon, type ToAddon } from './addonProtocol.js'

/** Protocol 2 messages as the sandbox and an add-on exchange them today (#964) - one of each shape that has an envelope equivalent. */
const mappable: (FromAddon | ToAddon)[] = [
  { type: 'call', id: 1, method: 'speak', args: { text: 'Hallo' } },
  { type: 'call-result', id: 1, ok: true, data: { spoken: true }, files: [{ key: 'wav', bytes: new Uint8Array([7, 7]) }] },
  { type: 'call-result', id: 2, ok: false, message: 'Ungültige Stimme', messageCode: 'speech.invalidVoice' },
  { type: 'job', id: 3, job: { id: 'job-1', type: 'youtube-extract', input: { url: 'https://example.org/watch' } } },
  { type: 'job-result', id: 3, ok: true, files: [{ key: 'audio', bytes: new Uint8Array([1, 2, 3]) }], data: { title: 'Wonderwall' } },
  { type: 'job-result', id: 4, ok: false, message: 'video unavailable', messageCode: 'youtube.failed' },
  { type: 'job-progress', id: 3, fraction: 0.5 },
  { type: 'helper-run', id: 5, request: 1, helper: 'yt-dlp', args: ['-x'], files: [{ name: 'input', bytes: new Uint8Array([4]) }] },
  { type: 'helper-result', id: 5, request: 1, result: { codec: 'opus' }, files: [{ name: 'a.webm', bytes: new Uint8Array([9]) }] },
  { type: 'helper-result', id: 6, request: 2, result: null, files: [], error: 'exit 1: no such video' },
  { type: 'health', status: 'online' },
  { type: 'health', status: 'error', message: 'The add-on threw: boom' },
  { type: 'log', line: 'searching' },
]

describe('the protocol 2 adapter (#964)', () => {
  it('maps every message with an envelope equivalent, and back to the same envelope', () => {
    for (const message of mappable) {
      const envelope = toEnvelope(message)
      expect(envelope, message.type).not.toBeNull()
      const back = fromEnvelope(envelope!)
      expect(back, message.type).not.toBeNull()
      // Envelope in, envelope out: an adapter must not lose what it carried (docs/36 §4).
      expect(toEnvelope(back!), message.type).toEqual(envelope)
    }
  })

  it('names a call by its method, with the arguments in the body', () => {
    expect(toEnvelope({ type: 'call', id: 7, method: 'speak', args: { text: 'Hallo' } })).toEqual({
      kind: 'request',
      id: 7,
      method: 'speak',
      body: { args: { text: 'Hallo' } },
    })
  })

  it('names a job `job:<type>` and keeps the job document in the body', () => {
    expect(toEnvelope({ type: 'job', id: 8, job: { id: 'job-9', type: 'stem-separation', input: { track: 'a' } } })).toEqual({
      kind: 'request',
      id: 8,
      method: 'job:stem-separation',
      body: { id: 'job-9', type: 'stem-separation', input: { track: 'a' } },
    })
  })

  it("asks for a helper as the request method `capability.helper` and keeps StageBoard's request number", () => {
    expect(toEnvelope({ type: 'helper-run', id: 9, request: 4, helper: 'yt-dlp', args: ['-x'] })).toEqual({
      kind: 'request',
      id: 9,
      method: 'capability.helper',
      body: { request: 4, helper: 'yt-dlp', args: ['-x'] },
    })
  })

  it('carries progress, log and health as one-way news with a topic', () => {
    expect(toEnvelope({ type: 'job-progress', id: 3, fraction: 0.25 })).toEqual({ kind: 'notify', topic: 'progress', body: { id: 3, fraction: 0.25 } })
    expect(toEnvelope({ type: 'log', line: 'searching' })).toEqual({ kind: 'notify', topic: 'log', body: { line: 'searching' } })
    expect(toEnvelope({ type: 'health', status: 'offline' })).toEqual({ kind: 'notify', topic: 'health', body: { status: 'offline' } })
  })

  it('carries the add-on\'s error code and message into a failed response', () => {
    expect(toEnvelope({ type: 'call-result', id: 2, ok: false, message: 'Ungültige Stimme', messageCode: 'speech.invalidVoice' })).toEqual({
      kind: 'response',
      id: 2,
      ok: false,
      error: { code: 'speech.invalidVoice', message: 'Ungültige Stimme', params: { from: 'call-result' } },
    })
  })

  it('says nothing about messages without an envelope equivalent', () => {
    const unmappable: (FromAddon | ToAddon)[] = [
      { type: 'init', apiVersion: 1, protocol: 2, settings: {}, permissions: [], language: 'de' },
      { type: 'event', id: 1, event: { type: 'knob' }, context: { midiChannel: 1 } },
      { type: 'result', id: 1, result: { status: 'ok' } },
      { type: 'midi-out', id: 1, bytes: [176, 7, 100] },
      { type: 'midi-reply', id: 1, request: 1, data: null },
      { type: 'shutdown' },
    ]
    for (const message of unmappable) expect(toEnvelope(message), message.type).toBeNull()
  })

  it('returns null for envelope kinds that have no protocol 2 message', () => {
    const envelopes: Envelope[] = [
      { kind: 'subscribe', id: 1, stream: 'device:qlc.scene' },
      { kind: 'update', id: 1, body: { scene: 'a' } },
      { kind: 'ui-set', slot: 'song-editor.track-source', tree: {} },
      { kind: 'ui-action', slot: 'song-editor.track-source', action: 'search' },
      { kind: 'notify', topic: 'state', body: {} },
    ]
    for (const envelope of envelopes) expect(fromEnvelope(envelope), envelope.kind).toBeNull()
  })

  it('reads a response from a protocol 3 script without a marker as a call result', () => {
    expect(fromEnvelope({ kind: 'response', id: 11, ok: true, body: { results: [] } })).toEqual({
      type: 'call-result',
      id: 11,
      ok: true,
      data: { results: [] },
      files: [],
    })
  })

  it('refuses a malformed body instead of inventing a message', () => {
    expect(fromEnvelope({ kind: 'request', id: 12, method: 'capability.helper', body: { args: [] } })).toBeNull()
    expect(fromEnvelope({ kind: 'notify', topic: 'health', body: { status: 'maybe' } })).toBeNull()
  })
})
