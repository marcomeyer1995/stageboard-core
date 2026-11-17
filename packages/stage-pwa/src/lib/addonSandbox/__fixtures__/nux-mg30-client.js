// StageBoard add-on: NUX MG-30 (docs/32 §4, sandboxed JS add-on).
// Runs in its own Worker and speaks only through messages: it gets an event and this device's
// MIDI channel, and answers with the bytes to send and a result. StageBoard picks the port and
// sends - only with the permission "midi-out:NUX MG-30".
//
// Protocol (reverse-engineered from mg30-controller, hardware-verified on firmware v4.0.3):
// program change selects a patch, control change sets a knob, SysEx "43 58" asks for the identity.
'use strict'

const SIGNATURE = [0x43, 0x58]
const IDENTITY_REQUEST = 0x00
const IDENTITY_RESPONSE = 0x10

// Knob CCs (the manual's "MIDI CC ASSIGNMENTS"): 11-74 without 16, and compressor knob 4 on 90.
const isKnob = (cc) => (cc >= 11 && cc <= 74 && cc !== 16) || cc === 90

let language = 'de'
const TEXT = {
  de: {
    range: (what, field, range) => `${what}: ${field} muss ${range} sein.`,
    notAKnob: (cc) => `mg30.setKnob: CC ${cc} ist kein Regler des MG-30.`,
    noIdentity: 'MG-30: keine Antwort auf die Identitätsabfrage.',
    unknown: (type) => `MG-30: unbekannter Event-Typ "${type}".`,
  },
  en: {
    range: (what, field, range) => `${what}: ${field} must be ${range}.`,
    notAKnob: (cc) => `mg30.setKnob: CC ${cc} is not an MG-30 knob.`,
    noIdentity: 'MG-30: no answer to the identity request.',
    unknown: (type) => `MG-30: unknown event type "${type}".`,
  },
}
const text = () => TEXT[language] || TEXT.en

let nextRequest = 1
const waiting = new Map()

function send(id, bytes) {
  self.postMessage({ type: 'midi-out', id, bytes })
}

function sendAndWait(id, bytes, prefix, timeoutMs) {
  const request = nextRequest++
  return new Promise((resolve) => {
    waiting.set(request, resolve)
    self.postMessage({ type: 'midi-out', id, bytes, request, expectReply: { prefix, timeoutMs } })
  })
}

function selectPatch(id, channel, payload) {
  const program = Number(payload && payload.program)
  if (!Number.isInteger(program) || program < 0 || program > 127) {
    return { status: 'error', message: text().range('mg30.selectPatch', 'program', '0-127') }
  }
  send(id, [0xc0 | (channel & 0x0f), program])
  const bank = Math.floor(program / 4) + 1
  return { status: 'ok', data: { program, patchName: `${String(bank).padStart(2, '0')}${'ABCD'[program % 4]}` } }
}

function setKnob(id, channel, payload) {
  const cc = Number(payload && payload.cc)
  const value = Number(payload && payload.value)
  if (!isKnob(cc)) return { status: 'error', message: text().notAKnob(String(payload && payload.cc)) }
  if (!Number.isInteger(value) || value < 0 || value > 127) {
    return { status: 'error', message: text().range('mg30.setKnob', 'value', '0-127') }
  }
  send(id, [0xb0 | (channel & 0x0f), cc, value])
  return { status: 'ok', data: { cc, value } }
}

// Read-only round trip: F0 43 58 00 F7, the reply F0 43 58 10 <firmware, 6 ASCII bytes> ... F7.
async function test(id) {
  const reply = await sendAndWait(id, [0xf0, ...SIGNATURE, IDENTITY_REQUEST, 0xf7], [0xf0, ...SIGNATURE, IDENTITY_RESPONSE], 1000)
  if (!reply) return { status: 'error', message: text().noIdentity }
  const version = String.fromCharCode(...reply.slice(4, 10).filter((byte) => byte !== 0))
  return { status: 'ok', message: `Firmware ${version}` }
}

async function handle(id, event, context) {
  const channel = (Number.isInteger(context.midiChannel) && context.midiChannel >= 1 && context.midiChannel <= 16 ? context.midiChannel : 1) - 1
  switch (event.type) {
    case 'mg30.selectPatch':
      return selectPatch(id, channel, event.payload)
    case 'mg30.setKnob':
      return setKnob(id, channel, event.payload)
    case 'test':
      return test(id)
    default:
      return { status: 'error', message: text().unknown(event.type) }
  }
}

self.onmessage = async (message) => {
  const data = message.data
  if (data.type === 'init') {
    language = data.language === 'en' ? 'en' : 'de'
    self.postMessage({ type: 'health', status: 'online' })
  } else if (data.type === 'event') {
    let result
    try {
      result = await handle(data.id, data.event, data.context || {})
    } catch (err) {
      result = { status: 'error', message: `MG-30: ${String(err)}` }
    }
    self.postMessage({ type: 'result', id: data.id, result })
  } else if (data.type === 'midi-reply') {
    const resolve = waiting.get(data.request)
    waiting.delete(data.request)
    if (resolve) resolve(data.data)
  }
}
