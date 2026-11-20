// The metadata look-up add-on (docs/32 §6, #964): a classic Worker script, no imports, in a sandbox. It answers two calls, `search` and `fetchDetail`,
// with MusicBrainz's official REST API. It is the one add-on that reaches the network itself, which is exactly what its `http:https://musicbrainz.org`
// permission says - and StageBoard performs the request for it, only to that origin. MusicBrainz requires a descriptive User-Agent.
var UA = 'StageBoard/0.1 (local band-management tool, no public deployment)'
var base = 'https://musicbrainz.org/ws/2/'
var waiting = {}
var nextId = 1

// The add-on holds no network handle (docs/36 §5): it asks StageBoard for `capability.http`, which performs it for the origins this add-on declared.
function request(path) {
  return new Promise(function (resolve, reject) {
    var id = nextId++
    waiting[id] = { resolve: resolve, reject: reject }
    self.postMessage({ kind: 'request', id: id, method: 'capability.http', body: { url: base + path, headers: { 'User-Agent': UA, Accept: 'application/json' } } })
  }).then(function (r) {
    if (r.status < 200 || r.status > 299) throw new Error('MusicBrainz request failed: HTTP ' + r.status)
    return JSON.parse(r.body)
  })
}
function artist(r) { return r['artist-credit'] && r['artist-credit'][0] ? r['artist-credit'][0].name : undefined }

self.onmessage = function (e) {
  var m = e.data
  if (m.kind === 'response') {
    var w = waiting[m.id]
    delete waiting[m.id]
    if (w) { if (m.ok) w.resolve(m.body); else w.reject(new Error(m.error.message)) }
    return
  }
  if (m.type === 'init') {
    if (m.settings && typeof m.settings.baseUrl === 'string') base = m.settings.baseUrl
    return
  }
  if (m.type !== 'call') return
  var done
  if (m.method === 'search') {
    done = request('recording/?query=' + encodeURIComponent(String(m.args.query || '')) + '&fmt=json&limit=10').then(function (body) {
      return (body.recordings || []).map(function (r) {
        var sub = [artist(r), r['first-release-date']].filter(Boolean).join(' · ')
        var out = { id: r.id, title: r.title, sourceUrl: 'https://musicbrainz.org/recording/' + r.id }
        if (sub) out.subtitle = sub
        return out
      })
    })
  } else if (m.method === 'fetchDetail') {
    var id = String(m.args.id || '')
    done = request('recording/' + encodeURIComponent(id) + '?fmt=json&inc=artist-credits').then(function (r) {
      return { title: r.title || null, artist: artist(r) || null, firstReleaseDate: r['first-release-date'] || null, sourceUrl: 'https://musicbrainz.org/recording/' + id }
    })
  } else {
    done = Promise.reject(new Error('Unknown method ' + m.method))
  }
  done.then(
    function (data) { self.postMessage({ type: 'call-result', id: m.id, ok: true, data: data }) },
    function (err) { self.postMessage({ type: 'call-result', id: m.id, ok: false, message: String(err && err.message || err) }) },
  )
}
