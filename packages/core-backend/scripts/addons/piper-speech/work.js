// The speech add-on's work script (docs/36 §2, #964): a classic script, no imports, in a sandbox. One method over the contract (protocol 3):
//   speak {text, voice, pace} -> {wav}     (Piper's raw WAV)
// It asks StageBoard for its declared helper `piper`, which runs the program in a work folder of its own. What is NOT here, on purpose: the clip
// cache, the queue, the trimming of silence, the checks of the text and the voice - StageBoard does those, so every device produces the same clip for
// the same text.
var waiting = {}
var nextId = 1

function helper(args, files) {
  return new Promise(function (resolve, reject) {
    var id = nextId++
    waiting[id] = { resolve: resolve, reject: reject }
    self.postMessage({ kind: 'request', id: id, method: 'capability.helper', body: { helper: 'piper', args: args, files: files } })
  })
}

self.onmessage = function (e) {
  var m = e.data
  if (m.kind === 'response') {
    var w = waiting[m.id]
    delete waiting[m.id]
    if (w) { if (m.ok) w.resolve(m.body); else w.reject(new Error(m.error.message)) }
  } else if (m.kind === 'request' && m.method === 'speak') {
    var text = new TextEncoder().encode(String(m.body.text || ''))
    helper([String(m.body.voice || ''), String(m.body.pace || 1)], [{ name: 'input', bytes: text }]).then(function (r) {
      if (!r.files.length) return self.postMessage({ kind: 'response', id: m.id, ok: false, error: { code: 'speech.none', message: 'The helper left no clip' } })
      self.postMessage({ kind: 'response', id: m.id, ok: true, body: { wav: r.files[0].bytes } })
    }, function (err) { self.postMessage({ kind: 'response', id: m.id, ok: false, error: { code: 'speech.failed', message: err.message } }) })
  } else if (m.kind === 'request') {
    self.postMessage({ kind: 'response', id: m.id, ok: false, error: { code: 'method.unknown', message: 'Unknown method ' + m.method } })
  }
}
