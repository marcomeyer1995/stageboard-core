// The metadata look-up add-on (docs/32 §6, #964): a classic Worker script, no imports, in a sandbox. It answers two calls, `search` and `fetchDetail`,
// with MusicBrainz's official REST API. It is the one add-on that reaches the network itself, which is exactly what its `http:musicbrainz.org`
// permission says; StageBoard hands it `fetch` only because it declared that. MusicBrainz requires a descriptive User-Agent.
var UA = 'StageBoard/0.1 (local band-management tool, no public deployment)'
var base = 'https://musicbrainz.org/ws/2/'

function request(path) {
  return fetch(base + path, { headers: { 'User-Agent': UA, Accept: 'application/json' } }).then(function (r) {
    if (!r.ok) throw new Error('MusicBrainz request failed: HTTP ' + r.status)
    return r.json()
  })
}
function artist(r) { return r['artist-credit'] && r['artist-credit'][0] ? r['artist-credit'][0].name : undefined }

self.onmessage = function (e) {
  var m = e.data
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
