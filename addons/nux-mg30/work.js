// The NUX MG-30 add-on's work script (docs/36, #964): a classic script, no imports, in a sandbox. One method, `event`: a cue for the MG-30 becomes
// MIDI, which StageBoard sends through `capability.midi-out` to the port of the MG-30 the cue is for - the add-on names no port. The MG-30's MIDI
// (patch Program Change, the knob CCs of its manual's "MIDI CC ASSIGNMENTS" table, the identity SysEx `F0 43 58 00 F7` -> `F0 43 58 10 <version>`,
// hardware-verified on firmware v4.0.3, as in the emulator's sysex.py and protocol-notes.md) and the words the musician reads are this add-on's.
var LANG = 'de'
var TEXT = {
  de: {
    range: function (p) { return p.what + ': ' + p.field + ' muss ' + p.range + ' sein.' },
    notAKnob: function (p) { return p.what + ': CC ' + p.cc + ' ist kein Regler des MG-30.' },
    noIdentity: function () { return 'MG-30: keine Antwort auf die Identitätsabfrage.' },
    unknown: function (p) { return 'MG-30: unbekannter Event-Typ „' + p.type + '“.' },
    gone: function () { return 'MG-30 nicht erreichbar: nicht angeschlossen oder ausgeschaltet.' },
    failed: function (p) { return 'MG-30: MIDI nicht gesendet: ' + p.error },
  },
  en: {
    range: function (p) { return p.what + ': ' + p.field + ' must be ' + p.range + '.' },
    notAKnob: function (p) { return p.what + ': CC ' + p.cc + ' is not an MG-30 knob.' },
    noIdentity: function () { return 'MG-30: no answer to the identity request.' },
    unknown: function (p) { return 'MG-30: unknown event type "' + p.type + '".' },
    gone: function () { return 'MG-30 not reachable: not plugged in or switched off.' },
    failed: function (p) { return 'MG-30: MIDI not sent: ' + p.error },
  },
}
function say(key, params) { return (TEXT[LANG] || TEXT.en)[key](params || {}) }

// `43 58`: the signature every MG-30 SysEx starts with (not a registered manufacturer id).
var SIGNATURE = [0x43, 0x58]
var IDENTITY_REQUEST = 0x00
var IDENTITY_RESPONSE = 0x10
// The knob CCs (block, switch and patch-wide controls): 11-15, 17-73 and the compressor's fourth knob, 90. Not CC 16 (unused) and not the block
// bypass/model CCs 0-10, whose values are per-model codes with no verified table - a guessed value could put the unit in an unintended state.
function isKnob(cc) { return Number.isInteger(cc) && ((cc >= 11 && cc <= 15) || (cc >= 17 && cc <= 73) || cc === 90) }

var waiting = {}
var nextId = 1
function midiOut(body) {
  return new Promise(function (resolve, reject) {
    var id = nextId++
    waiting[id] = { resolve: resolve, reject: reject }
    self.postMessage({ kind: 'request', id: id, method: 'capability.midi-out', body: body })
  })
}
function answer(id, result) { self.postMessage({ kind: 'response', id: id, ok: true, body: result }) }

function handle(id, type, payload, channel) {
  payload = payload || {}
  var status = function (high) { return high | ((channel - 1) & 0x0f) }
  if (type === 'mg30.selectPatch') {
    var program = Number(payload.program)
    if (!Number.isInteger(program) || program < 0 || program > 127) return Promise.resolve({ status: 'error', message: say('range', { what: type, field: 'program', range: '0-127' }) })
    var bank = Math.floor(program / 4) + 1
    return midiOut({ bytes: [status(0xc0), program], forRequest: id }).then(function () {
      return { status: 'ok', data: { program: program, patchName: (bank < 10 ? '0' : '') + bank + 'ABCD'.charAt(program % 4) } }
    })
  }
  if (type === 'mg30.setKnob') {
    var cc = Number(payload.cc)
    var value = Number(payload.value)
    if (!isKnob(cc)) return Promise.resolve({ status: 'error', message: say('notAKnob', { what: type, cc: String(payload.cc) }) })
    if (!Number.isInteger(value) || value < 0 || value > 127) return Promise.resolve({ status: 'error', message: say('range', { what: type, field: 'value', range: '0-127' }) })
    return midiOut({ bytes: [status(0xb0), cc, value], forRequest: id }).then(function () { return { status: 'ok', data: { cc: cc, value: value } } })
  }
  // "Testen": the identity request, read-only - the unit's patch and effects never change. StageBoard listens for the reply before it sends.
  if (type === 'test') {
    var prefix = [0xf0].concat(SIGNATURE, [IDENTITY_RESPONSE])
    return midiOut({ bytes: [0xf0].concat(SIGNATURE, [IDENTITY_REQUEST, 0xf7]), expectReply: { prefix: prefix, timeoutMs: 1000 }, forRequest: id }).then(function (sent) {
      if (!sent.reply) return { status: 'error', message: say('noIdentity') }
      var version = sent.reply.slice(4, 10).filter(function (b) { return b !== 0 }).map(function (b) { return String.fromCharCode(b) }).join('')
      return { status: 'ok', message: 'Firmware ' + version }
    })
  }
  return Promise.resolve({ status: 'error', message: say('unknown', { type: type }) })
}

self.onmessage = function (e) {
  var m = e.data
  if (m.type === 'init') {
    LANG = m.language === 'en' ? 'en' : 'de'
  } else if (m.kind === 'response') {
    var w = waiting[m.id]
    delete waiting[m.id]
    if (w) {
      if (m.ok) w.resolve(m.body)
      else { var err = new Error(m.error.message); err.code = m.error.code; w.reject(err) }
    }
  } else if (m.kind === 'request' && m.method === 'event') {
    var body = m.body || {}
    var channel = Number(body.midiChannel)
    if (!Number.isInteger(channel) || channel < 1 || channel > 16) channel = 1
    handle(m.id, String(body.type || ''), body.payload, channel).then(
      function (result) { answer(m.id, result) },
      function (err) { answer(m.id, { status: 'error', message: err.code === 'midi.no-port' ? say('gone') : say('failed', { error: err.message }) }) },
    )
  } else if (m.kind === 'request') {
    self.postMessage({ kind: 'response', id: m.id, ok: false, error: { code: 'method.unknown', message: say('unknown', { type: m.method }) } })
  }
}
