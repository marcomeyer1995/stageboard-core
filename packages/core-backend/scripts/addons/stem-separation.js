// The stem-separation add-on's jobs file (docs/32 §6, #964): a classic Worker script, no imports, in a sandbox. It cannot read, write, start a program
// or see the environment. It gets the audio in the job and asks StageBoard to run its declared helper `stems` on it; the stems come back as files.
// What is NOT here, on purpose: checking the ids and the band's plugin, finding the track, naming the stems, attaching them, deleting the replaced
// ones, writing the job's progress - StageBoard's recipe does that.
var pending = {}
var nextRequest = 1

self.onmessage = function (e) {
  var m = e.data
  if (m.type === 'job' && m.job.type === 'stem-separation') {
    var request = nextRequest++
    pending[request] = m.id
    var input = m.job.input
    var args = [String(input.model || 'standard')]
    if (input.splitGuitar) args.push('--split-guitar')
    console.log('separating (' + args.join(' ') + '), ' + input.audio.length + ' bytes')
    self.postMessage({ type: 'helper-run', id: m.id, request: request, helper: 'stems', args: args, files: [{ name: 'input', bytes: input.audio }] })
  } else if (m.type === 'helper-result') {
    var id = pending[m.request]
    delete pending[m.request]
    if (m.error) {
      self.postMessage({ type: 'job-result', id: id, ok: false, message: m.error })
    } else if (!m.files.length) {
      self.postMessage({ type: 'job-result', id: id, ok: false, message: 'The helper left no stems' })
    } else {
      var keys = {}
      for (var i = 0; i < m.result.stems.length; i++) keys[m.result.stems[i].key] = m.result.stems[i].opus
      self.postMessage({
        type: 'job-result', id: id, ok: true,
        files: m.files.map(function (f) { return { key: f.name.replace(/\.(opus|webm)$/, ''), bytes: f.bytes } }),
        data: { opus: keys },
      })
    }
  }
}
