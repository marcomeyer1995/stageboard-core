// The Kemper Profiler add-on's work script (docs/36, #964): a classic script, no imports, in a sandbox. One method, `event`: a show-control
// event for the Kemper becomes MIDI Control Changes, which StageBoard sends through `capability.midi-out`. The add-on never names a port - StageBoard
// grants, for this one cue, the output of the Kemper the cue is for (the device's own setting), and sends nothing without that grant.
// The Kemper's MIDI layout (its "Table 1" CC layer, the same table as stage-pwa's midiDeviceProtocols.ts and the emulator's cc_map.py) and the words
// the musician reads when something is wrong are this add-on's.
var LANG = 'de'
var TEXT = {
  de: {
    range: function (p) { return p.what + ': ' + p.field + ' muss ' + p.range + ' sein.' },
    stomp: function (p) { return p.what + ': unbekannter Stomp-Slot „' + p.name + '“.' },
    unknown: function (p) { return 'Kemper: unbekannter Event-Typ „' + p.type + '“.' },
    failed: function (p) { return 'Kemper: MIDI nicht gesendet: ' + p.error },
    gone: function () { return 'Kemper nicht erreichbar: nicht angeschlossen oder ausgeschaltet.' },
  },
  en: {
    range: function (p) { return p.what + ': ' + p.field + ' must be ' + p.range + '.' },
    stomp: function (p) { return p.what + ': unknown stomp slot "' + p.name + '".' },
    unknown: function (p) { return 'Kemper: unknown event type "' + p.type + '".' },
    failed: function (p) { return 'Kemper: MIDI not sent: ' + p.error },
    gone: function () { return 'Kemper not reachable: not plugged in or switched off.' },
  },
}
function say(key, params) { return (TEXT[LANG] || TEXT.en)[key](params || {}) }

var CC = { performancePreselect: 47, slot: [50, 51, 52, 53, 54], tuner: 31 }
var STOMP = { A: 17, B: 18, C: 19, D: 20, X: 22, MOD: 24, DELAY: 26, REVERB: 28, ALL: 16 }
var STOMP_WITH_TAIL = { DELAY: 27, REVERB: 29 }

var waiting = {}
var nextId = 1

function midiOut(bytes, forRequest) {
  return new Promise(function (resolve, reject) {
    var id = nextId++
    waiting[id] = { resolve: resolve, reject: reject }
    self.postMessage({ kind: 'request', id: id, method: 'capability.midi-out', body: { bytes: bytes, forRequest: forRequest } })
  })
}

// One Control Change on the device's channel (1-16), each message sent as soon as the one before it went out.
function controlChanges(list, channel, forRequest) {
  var status = 0xb0 | ((channel - 1) & 0x0f)
  return list.reduce(function (done, cc) {
    return done.then(function () { return midiOut([status, cc[0], cc[1]], forRequest) })
  }, Promise.resolve())
}

function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms) }) }

// What one event becomes: the Control Changes, or a refusal in the musician's words (nothing is sent then).
function plan(type, payload) {
  payload = payload || {}
  if (type === 'kemper.selectRig') {
    var performance = Number(payload.performance)
    var slot = Number(payload.slot)
    if (!Number.isInteger(performance) || performance < 0 || performance > 124) return { refuse: say('range', { what: type, field: 'performance', range: '0-124' }) }
    if (!Number.isInteger(slot) || slot < 1 || slot > 5) return { refuse: say('range', { what: type, field: 'slot', range: '1-5' }) }
    return { steps: [[[CC.performancePreselect, performance], [CC.slot[slot - 1], 127]]], data: { performance: performance, slot: slot } }
  }
  if (type === 'kemper.stomp') {
    var name = String(payload.stomp || '').toUpperCase()
    var withTail = payload.tail === true
    var cc = (withTail && STOMP_WITH_TAIL[name]) || STOMP[name]
    if (!cc) return { refuse: say('stomp', { what: type, name: name }) }
    var off = payload.off === true
    return { steps: [[[cc, off ? 0 : 127]]], data: { stomp: name, tail: withTail, on: !off } }
  }
  if (type === 'kemper.tuner') {
    var tunerOff = payload.off === true
    return { steps: [[[CC.tuner, tunerOff ? 0 : 127]]], data: { on: !tunerOff } }
  }
  // "Testen": the tuner display flashes - a visible sign the connection is alive.
  if (type === 'test') return { steps: [[[CC.tuner, 127]], [[CC.tuner, 0]]], pause: 150 }
  return { refuse: say('unknown', { type: type }) }
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
    var todo = plan(String(body.type || ''), body.payload)
    if (todo.refuse) return self.postMessage({ kind: 'response', id: m.id, ok: true, body: { status: 'error', message: todo.refuse } })
    todo.steps
      .reduce(function (done, step, i) {
        return done.then(function () { return i > 0 && todo.pause ? wait(todo.pause) : undefined }).then(function () { return controlChanges(step, channel, m.id) })
      }, Promise.resolve())
      .then(
        function () { self.postMessage({ kind: 'response', id: m.id, ok: true, body: todo.data ? { status: 'ok', data: todo.data } : { status: 'ok' } }) },
        function (err) { self.postMessage({ kind: 'response', id: m.id, ok: true, body: { status: 'error', message: err.code === 'midi.no-port' ? say('gone') : say('failed', { error: err.message }) } }) },
      )
  } else if (m.kind === 'request') {
    self.postMessage({ kind: 'response', id: m.id, ok: false, error: { code: 'method.unknown', message: say('unknown', { type: m.method }) } })
  }
}
