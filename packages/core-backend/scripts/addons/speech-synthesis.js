// The speech add-on's jobs file (docs/32 §6, #964): a classic Worker script, no imports, in a sandbox. It answers one call, `speak`: the text becomes
// Piper's raw WAV through the helper `piper`, which StageBoard runs for it. What is NOT here, on purpose: the clip cache, the queue, the trimming of
// silence, the checks of the text and the voice - StageBoard does those, so every device produces the same clip for the same text.
var pending = {}
var nextRequest = 1

self.onmessage = function (e) {
  var m = e.data
  if (m.type === 'call' && m.method === 'speak') {
    var request = nextRequest++
    pending[request] = m.id
    var text = new TextEncoder().encode(String(m.args.text || ''))
    self.postMessage({ type: 'helper-run', id: m.id, request: request, helper: 'piper', args: [String(m.args.voice || ''), String(m.args.pace || 1)], files: [{ name: 'input', bytes: text }] })
  } else if (m.type === 'helper-result') {
    var id = pending[m.request]
    delete pending[m.request]
    if (m.error) self.postMessage({ type: 'call-result', id: id, ok: false, message: m.error })
    else if (!m.files.length) self.postMessage({ type: 'call-result', id: id, ok: false, message: 'The helper left no clip' })
    else self.postMessage({ type: 'call-result', id: id, ok: true, files: [{ key: 'wav', bytes: m.files[0].bytes }] })
  }
}
