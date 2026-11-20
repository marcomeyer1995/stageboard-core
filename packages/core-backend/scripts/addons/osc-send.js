// The OSC add-on's jobs file (docs/32 §6, #964): a classic Worker script, no imports, in a sandbox. One call, `send`: the cue's address and values
// become one OSC 1.0 packet, which the device's helper `udp-send` puts on the network (an add-on has no socket and starts no program). OSC itself -
// the address rules, the typed arguments, the byte layout - is this add-on's knowledge. Where to send (the device's own network settings) and the
// musician's words for a failure are StageBoard's.
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
  if (m.type === 'call' && m.method === 'send') {
    var address = String(m.args.address || '').trim()
    if (!/^\/[^\s#*,?[\]{}]*$/.test(address)) return self.postMessage({ type: 'call-result', id: m.id, ok: true, data: { error: 'invalid-address', address: address } })
    var packet = encode(address, parseArgs(String(m.args.args || '')))
    var request = nextRequest++
    pending[request] = m.id
    self.postMessage({ type: 'helper-run', id: m.id, request: request, helper: 'udp-send', args: [String(m.args.host), String(m.args.port)], files: [{ name: 'packet', bytes: packet }] })
  } else if (m.type === 'helper-result') {
    var id = pending[m.request]
    delete pending[m.request]
    self.postMessage({ type: 'call-result', id: id, ok: !m.error, data: m.error ? undefined : { sent: true }, message: m.error || undefined })
  }
}
