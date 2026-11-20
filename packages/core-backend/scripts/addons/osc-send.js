// The OSC add-on's jobs file (docs/32 §6, #964): a classic Worker script, no imports, in a sandbox. One call, `send`: the cue's address and values
// become one OSC 1.0 packet, which the device's helper `udp-send` puts on the network (an add-on has no socket and starts no program). OSC itself -
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
function refuse(id, key, params) { self.postMessage({ type: 'call-result', id: id, ok: false, message: say(key, params) }) }
var pending = {}
var nextRequest = 1
var enc = new TextEncoder()

function oscString(s) {
  var bytes = enc.encode(s)
  var out = new Uint8Array(Math.ceil((bytes.length + 1) / 4) * 4)
  out.set(bytes)
  return out
}

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

self.onmessage = function (e) {
  var m = e.data
  if (m.type === 'init') {
    LANG = m.language === 'en' ? 'en' : 'de'
  } else if (m.type === 'call' && m.method === 'send') {
    var address = String(m.args.address || '').trim()
    if (!/^\/[^\s#*,?[\]{}]*$/.test(address)) return refuse(m.id, 'address', { address: address })
    if (!m.args.host || !m.args.port) return refuse(m.id, 'noTarget')
    var packet = encode(address, parseArgs(String(m.args.args || '')))
    var request = nextRequest++
    pending[request] = { id: m.id, host: m.args.host, port: m.args.port }
    self.postMessage({ type: 'helper-run', id: m.id, request: request, helper: 'udp-send', args: [String(m.args.host), String(m.args.port)], files: [{ name: 'packet', bytes: packet }] })
  } else if (m.type === 'helper-result') {
    var p = pending[m.request]
    delete pending[m.request]
    if (m.error) refuse(p.id, 'failed', { host: p.host, port: p.port, error: m.error })
    else self.postMessage({ type: 'call-result', id: p.id, ok: true, data: { sent: true } })
  } else if (m.type === 'call') {
    refuse(m.id, 'unknown', { type: m.method })
  }
}
