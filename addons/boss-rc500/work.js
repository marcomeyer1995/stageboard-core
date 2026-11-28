// The BOSS RC-500 add-on's work script (docs/36, #964): a classic script, no imports, in a sandbox. One method, `event`: a cue for the RC-500 becomes
// MIDI, which StageBoard sends through `capability.midi-out` to the port of the RC-500 the cue is for - the add-on names no port.
// The RC-500's MIDI and the words the musician reads are this add-on's. Its only fixed control is Program Change 1-99 for its 99 memories (owner's
// manual p.20-21, wire value = memory - 1); every CC's meaning is per memory, set up on the device, so no CC is offered. It has no SysEx and answers
// nothing, so there is no honest automatic test.
var LANG = 'de'
var TEXT = {
  de: {
    range: function (p) { return p.what + ': ' + p.field + ' muss ' + p.range + ' sein.' },
    noAutoTest: function () { return 'RC-500: kein automatischer Test möglich - das Gerät hat keine Rückmeldung.' },
    unknown: function (p) { return 'RC-500: unbekannter Event-Typ „' + p.type + '“.' },
    gone: function () { return 'RC-500 nicht erreichbar: nicht angeschlossen oder ausgeschaltet.' },
    failed: function (p) { return 'RC-500: MIDI nicht gesendet: ' + p.error },
  },
  en: {
    range: function (p) { return p.what + ': ' + p.field + ' must be ' + p.range + '.' },
    noAutoTest: function () { return 'RC-500: no automatic test possible - the device sends no reply.' },
    unknown: function (p) { return 'RC-500: unknown event type "' + p.type + '".' },
    gone: function () { return 'RC-500 not reachable: not plugged in or switched off.' },
    failed: function (p) { return 'RC-500: MIDI not sent: ' + p.error },
  },
}
function say(key, params) { return (TEXT[LANG] || TEXT.en)[key](params || {}) }

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
  if (type === 'rc500.selectMemory') {
    var memory = Number(payload.memory)
    if (!Number.isInteger(memory) || memory < 1 || memory > 99) return Promise.resolve({ status: 'error', message: say('range', { what: type, field: 'memory', range: '1-99' }) })
    return midiOut({ bytes: [0xc0 | ((channel - 1) & 0x0f), memory - 1], forRequest: id }).then(function () { return { status: 'ok', data: { memory: memory } } })
  }
  if (type === 'test') return Promise.resolve({ status: 'error', message: say('noAutoTest') })
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
