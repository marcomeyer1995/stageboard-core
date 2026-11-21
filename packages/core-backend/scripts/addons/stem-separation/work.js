// The stem-separation add-on's work script (docs/36 §2, #964): a classic script, no imports, in a sandbox. One method over the contract (protocol 3):
//   separate {audio, model, splitGuitar} -> {stems: [{key, opus, data}]}   (long: the helper's progress reaches the caller)
// It cannot read, write, start a program or see the environment: it asks StageBoard for its declared helper `stems`, which runs Demucs in a work folder
// of its own. What is NOT here, on purpose: checking the ids and the band's plugin, finding the track, naming the stems, attaching them, deleting the
// replaced ones, writing the job's progress - StageBoard's recipe does that.
var waiting = {}
var nextId = 1

function helper(args, files, forRequest) {
  return new Promise(function (resolve, reject) {
    var id = nextId++
    waiting[id] = { resolve: resolve, reject: reject }
    self.postMessage({ kind: 'request', id: id, method: 'capability.helper', body: { helper: 'stems', args: args, files: files, forRequest: forRequest } })
  })
}
function respond(id, body) { self.postMessage({ kind: 'response', id: id, ok: true, body: body }) }
function refuse(id, code, message) { self.postMessage({ kind: 'response', id: id, ok: false, error: { code: code, message: message } }) }

self.onmessage = function (e) {
  var m = e.data
  if (m.kind === 'response') {
    var w = waiting[m.id]
    delete waiting[m.id]
    if (w) { if (m.ok) w.resolve(m.body); else w.reject(new Error(m.error.message)) }
  } else if (m.kind === 'request' && m.method === 'separate') {
    var input = m.body
    var args = [String(input.model || 'standard')]
    if (input.splitGuitar) args.push('--split-guitar')
    console.log('separating (' + args.join(' ') + '), ' + input.audio.length + ' bytes')
    helper(args, [{ name: 'input', bytes: input.audio }], m.id).then(function (r) {
      if (!r.files.length) return refuse(m.id, 'stems.none', 'The helper left no stems')
      var opus = {}
      for (var i = 0; i < r.result.stems.length; i++) opus[r.result.stems[i].key] = r.result.stems[i].opus
      respond(m.id, { stems: r.files.map(function (f) { var key = f.name.replace(/\.(opus|webm)$/, ''); return { key: key, opus: opus[key] === true, data: f.bytes } }) })
    }, function (err) { refuse(m.id, 'stems.failed', err.message) })
  } else if (m.kind === 'request') {
    refuse(m.id, 'method.unknown', 'Unknown method ' + m.method)
  }
}
