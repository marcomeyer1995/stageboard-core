// The OSC add-on's work script (docs/32 §6, #964): a classic script, no imports, in a sandbox. One call, `send`: the cue's address and values
// become one OSC 1.0 packet, which StageBoard's `capability.udp` puts on the network (an add-on has no socket and starts no program). OSC itself -
// the address rules, the typed arguments, the byte layout - is this add-on's knowledge. The words the musician reads when it fails are this add-on's too.
// Where to send is the device's own network setting; StageBoard hands it over with the cue (`host`, `port`, absent when the device has none).
var LANG = 'de'
var TEXT = {
  de: {
    unknown: function (p) { return 'Unbekannter OSC-Befehl: ' + p.type },
    address: function (p) { return 'Keine gültige OSC-Adresse: „' + p.address + '“' },
    noTarget: function () { return 'Für dieses OSC-Gerät fehlen Host und Port (Bühne).' },
    failed: function (p) { return 'OSC an ' + p.host + ':' + p.port + ' fehlgeschlagen: ' + p.error },
  },
  en: {
    unknown: function (p) { return 'Unknown OSC command: ' + p.type },
    address: function (p) { return 'Not a valid OSC address: "' + p.address + '"' },
    noTarget: function () { return 'This OSC device has no host and port set (stage).' },
    failed: function (p) { return 'OSC to ' + p.host + ':' + p.port + ' failed: ' + p.error },
  },
}
function say(key, params) { return (TEXT[LANG] || TEXT.en)[key](params || {}) }
var waiting = {}
var nextId = 1
var enc = new TextEncoder()

// An OSC string: UTF-8, NUL-terminated, padded to a multiple of 4 bytes.
function oscString(s) {
  var bytes = enc.encode(s)
  var out = new Uint8Array(Math.ceil((bytes.length + 1) / 4) * 4)
  out.set(bytes)
  return out
}

function refuse(id, code, key, params) { self.postMessage({ kind: 'response', id: id, ok: false, error: { code: code, message: say(key, params) } }) }

function parseArgs(text) {
  var tokens = text.match(/"[^"]*"|\S+/g) || []
  return tokens.map(function (t) {
    if (t.charAt(0) === '"' && t.charAt(t.length - 1) === '"' && t.length >= 2) return { type: 's', value: t.slice(1, -1) }
    if (/^-?\d+$/.test(t) && Math.abs(Number(t)) <= 2147483647) return { type: 'i', value: Number(t) }
    if (/^-?(\d+\.\d*|\.\d+|\d+)(e-?\d+)?$/i.test(t.replace(',', '.'))) return { type: 'f', value: Number(t.replace(',', '.')) }
    if (t === 'true') return { type: 'T' }
    if (t === 'false') return { type: 'F' }
    return { type: 's', value: t }
  })
}

function encode(address, args) {
  var parts = [oscString(address), oscString(',' + args.map(function (a) { return a.type }).join(''))]
  args.forEach(function (a) {
    if (a.type === 'i' || a.type === 'f') {
      var b = new Uint8Array(4)
      var v = new DataView(b.buffer)
      if (a.type === 'i') v.setInt32(0, a.value)
      else v.setFloat32(0, a.value)
      parts.push(b)
    } else if (a.type === 's') parts.push(oscString(a.value))
  })
  var total = parts.reduce(function (n, p) { return n + p.length }, 0)
  var out = new Uint8Array(total)
  var at = 0
  parts.forEach(function (p) { out.set(p, at); at += p.length })
  return out
}

// The datagram goes out through StageBoard's `capability.udp`. The add-on has NO permission of its own to send anywhere: StageBoard grants, for this one
// call, exactly the target the device's own settings name (`forRequest` says which call it serves) - a target of the add-on's choosing is refused.
function sendUdp(host, port, bytes, forRequest) {
  return new Promise(function (resolve, reject) {
    var id = nextId++
    waiting[id] = { resolve: resolve, reject: reject }
    self.postMessage({ kind: 'request', id: id, method: 'capability.udp', body: { host: host, port: port, bytes: bytes, forRequest: forRequest } })
  })
}

self.onmessage = function (e) {
  var m = e.data
  if (m.type === 'init') {
    LANG = m.language === 'en' ? 'en' : 'de'
  } else if (m.kind === 'response') {
    var w = waiting[m.id]
    delete waiting[m.id]
    if (w) { if (m.ok) w.resolve(m.body); else w.reject(new Error(m.error.message)) }
  } else if (m.kind === 'request' && m.method === 'send') {
    var address = String(m.body.address || '').trim()
    if (!/^\/[^\s#*,?[\]{}]*$/.test(address)) return refuse(m.id, 'osc.address', 'address', { address: address })
    if (!m.body.host || !m.body.port) return refuse(m.id, 'osc.no-target', 'noTarget')
    var packet = encode(address, parseArgs(String(m.body.args || '')))
    sendUdp(String(m.body.host), Number(m.body.port), packet, m.id).then(
      function () {
        // The device's state (docs/36 §5a): what was last sent to it. StageBoard checks this against the field this add-on declared and shares it with the band.
        if (m.body.device) self.postMessage({ kind: 'notify', topic: 'state', body: { device: String(m.body.device), key: 'lastCue', value: (address + (m.body.args ? ' ' + String(m.body.args) : '')).slice(0, 400) } })
        self.postMessage({ kind: 'response', id: m.id, ok: true, body: { sent: true } })
      },
      function (err) { refuse(m.id, 'osc.failed', 'failed', { host: m.body.host, port: m.body.port, error: err.message }) },
    )
  } else if (m.kind === 'request') {
    refuse(m.id, 'method.unknown', 'unknown', { type: m.method })
  }
}
