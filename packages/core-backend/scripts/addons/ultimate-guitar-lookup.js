// The Ultimate Guitar look-up add-on (docs/32 §6, #964): a classic Worker script, no imports, in a sandbox. It answers `search` and `fetchDetail`.
// The page itself is read by the device's helper `ug-page` (a real Chrome - UG sits behind Cloudflare; an add-on can start no program, so it asks).
// What UG's data means is this add-on's job: which entries are importable, the order, which fields a tab detail has. When UG changes its site,
// THIS file is what gets updated. What is not here: turning the tab text into ChordPro and the musician's error messages - StageBoard does that.
var NOT_IMPORTABLE = { Pro: 1, Official: 1, Video: 1 }
var pending = {}
var nextRequest = 1

function score(rating, votes) {
  if (rating === undefined || rating === null) return -1
  var v = Math.max(0, votes || 0)
  return (v * rating + 50 * 4) / (v + 50)
}

function ask(id, url, then) {
  var request = nextRequest++
  pending[request] = { id: id, then: then }
  self.postMessage({ type: 'helper-run', id: id, request: request, helper: 'ug-page', args: [url] })
}

function d(page) { return page.data || {} }

self.onmessage = function (e) {
  var m = e.data
  if (m.type === 'call' && m.method === 'search') {
    ask(m.id, 'https://www.ultimate-guitar.com/search.php?search_type=title&value=' + encodeURIComponent(String(m.args.query || '')), function (page) {
      if (!page.hasData) return { page: page }
      var results = (d(page).results || []).filter(function (r) { return typeof r.type === 'string' && r.type.length > 0 && !NOT_IMPORTABLE[r.type] })
      results.sort(function (a, b) { return score(b.rating, b.votes) - score(a.rating, a.votes) })
      return {
        page: { hasData: true, title: page.title },
        results: results.map(function (r) {
          var o = { id: r.id + '::' + r.tab_url, title: r.song_name, subtitle: [r.artist_name, r.type, r.tonality_name].filter(Boolean).join(' · '), sourceUrl: r.tab_url }
          if (typeof r.rating === 'number') o.rating = Math.round(r.rating * 100) / 100
          if (typeof r.votes === 'number') o.votes = r.votes
          return o
        }),
      }
    })
  } else if (m.type === 'call' && m.method === 'fetchDetail') {
    var tabUrl = String(m.args.url || '')
    ask(m.id, tabUrl, function (page) {
      var data = d(page), view = data.tab_view || {}, meta = view.meta || {}, tab = data.tab || {}
      var tuning = meta.tuning || {}
      var s = view.strummings && view.strummings[0]
      return {
        page: { hasData: page.hasData, title: page.title },
        detail: {
          content: (view.wiki_tab && view.wiki_tab.content) || null,
          title: tab.song_name || null, artist: tab.artist_name || null,
          key: meta.tonality || tab.tonality_name || null,
          tuning: tuning.value || tuning.name || null,
          capo: meta.capo === undefined ? null : meta.capo,
          bpm: s && s.bpm !== undefined ? s.bpm : null,
        },
      }
    })
  } else if (m.type === 'helper-result') {
    var p = pending[m.request]
    delete pending[m.request]
    if (m.error) return self.postMessage({ type: 'call-result', id: p.id, ok: false, message: m.error })
    // A failure the helper already knows the musician's words for (no Chrome, timeout, ...) is handed back untouched.
    if (m.result && m.result.error) return self.postMessage({ type: 'call-result', id: p.id, ok: true, data: { error: m.result.error } })
    try { self.postMessage({ type: 'call-result', id: p.id, ok: true, data: p.then(m.result) }) }
    catch (err) { self.postMessage({ type: 'call-result', id: p.id, ok: false, message: String(err && err.message || err) }) }
  }
}
