// The YouTube add-on's jobs file (docs/32 §6, #964): a classic Worker script - the same kind of file a tablet runs in a Worker, no imports.
// It runs in a sandbox: it cannot read, write, start a program or (on Node) see the environment. All it can do is send messages. To download
// it asks StageBoard to run its declared helper (`yt-dlp` on a laptop; on Android the helper app, docs/32 §8) and hands the audio file back.
// What is NOT here, on purpose: checking the link, storing the file, attaching the track, writing the job's progress - StageBoard does that.
var pending = {}
var nextRequest = 1

self.onmessage = function (e) {
  var m = e.data
  if (m.type === 'job' && m.job.type === 'youtube-extract') {
    var request = nextRequest++
    pending[request] = m.id
    console.log('downloading ' + m.job.input.url)
    self.postMessage({ type: 'helper-run', id: m.id, request: request, helper: 'yt-dlp', args: [String(m.job.input.url)] })
  } else if (m.type === 'helper-result') {
    var id = pending[m.request]
    delete pending[m.request]
    if (m.error) {
      self.postMessage({ type: 'job-result', id: id, ok: false, message: m.error })
    } else if (!m.files.length) {
      self.postMessage({ type: 'job-result', id: id, ok: false, message: 'The helper left no file' })
    } else {
      self.postMessage({ type: 'job-result', id: id, ok: true, files: [{ key: 'audio', bytes: m.files[0].bytes }], data: { ext: (m.result && m.result.ext) || '' } })
    }
  }
}
