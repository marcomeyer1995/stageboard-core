// The YouTube add-on's view script (docs/36 §6, §7, #964): a classic script, no imports, in a Worker of the viewer's own device. It fills the slot
// `song-editor.track-source` - the dialog "From YouTube" of the song editor - and does it with a DESCRIPTION: a tree of StageBoard's own building blocks.
// It has no page, no DOM and no network; it asks (`request`) and StageBoard answers. Where the work happens (search, download) is not its business: the
// methods `search` and `fetchAudio` of the work script run on some device that has yt-dlp.
// Everything the person reads is here, in the language it was given: StageBoard knows nothing of YouTube.
var LANG = 'de'
var TEXT = {
  de: {
    title: 'Von YouTube laden',
    queryLabel: 'Titel Band oder YouTube-Link',
    search: 'Suchen',
    searching: 'Suche läuft …',
    nothing: 'Nichts gefunden.',
    reference: 'YouTube Referenz',
    queued: 'Wird im Hintergrund geladen: ',
    queuedHint: 'Du kannst das Fenster schließen - die Spur erscheint im Song, sobald sie fertig ist.',
    done: 'Fertig - die Spur ist im Song.',
    jobFailed: 'Der Import ist fehlgeschlagen:',
    close: 'Schließen',
    failed: 'Das hat nicht geklappt.',
  },
  en: {
    title: 'Load from YouTube',
    queryLabel: 'Title band or YouTube link',
    search: 'Search',
    searching: 'Searching …',
    nothing: 'Nothing found.',
    reference: 'YouTube reference',
    queued: 'Loading in the background: ',
    queuedHint: 'You can close this window - the track appears in the song when it is ready.',
    done: 'Done - the track is in the song.',
    jobFailed: 'The import failed:',
    close: 'Close',
    failed: 'That did not work.',
  },
}
function say(key) { return (TEXT[LANG] || TEXT.en)[key] }

var SLOT = 'song-editor.track-source'
var YOUTUBE_URL = /^https:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{6,}/
var state = { query: '', searching: false, hits: null, error: null, job: null, jobStatus: null }
var waiting = {}
var nextId = 1

function ask(method, body) {
  return new Promise(function (resolve) {
    var id = nextId++
    waiting[id] = resolve
    self.postMessage({ kind: 'request', id: id, method: method, body: body })
  })
}

function duration(seconds) { return Math.floor(seconds / 60) + ':' + ('0' + (seconds % 60)).slice(-2) }

function tree() {
  var children = [
    { type: 'row', children: [
      { type: 'field', id: 'query', label: say('queryLabel'), value: state.query },
      { type: 'button', variant: 'primary', label: say('search'), action: 'search', disabled: state.searching },
    ] },
  ]
  if (state.error) children.push({ type: 'text', role: 'error', text: state.error })
  if (state.searching) children.push({ type: 'text', role: 'hint', text: say('searching') })
  if (state.hits && state.hits.length === 0) children.push({ type: 'text', role: 'hint', text: say('nothing') })
  if (state.hits && state.hits.length > 0) {
    children.push({ type: 'list', children: state.hits.map(function (hit, i) {
      var channel = hit.channel || ''
      var length = typeof hit.durationSec === 'number' ? duration(hit.durationSec) : ''
      var row = { type: 'listRow', title: hit.title, subtitle: [channel, length].filter(Boolean).join(' · '), action: 'pick:' + i }
      row.image = { src: 'https://i.ytimg.com/vi/' + hit.id + '/mqdefault.jpg', role: 'thumb' }
      return row
    }) })
  }
  if (state.job) {
    children.push({ type: 'card', children: [
      { type: 'text', role: 'body', text: state.jobStatus === 'done' ? say('done') : state.jobStatus === 'error' ? say('jobFailed') : say('queued') + state.job.label },
      { type: 'progress', value: { bind: 'job:' + state.job.id + '.progress' } },
      { type: 'text', role: 'hint', text: state.jobStatus === 'done' || state.jobStatus === 'error' ? '' : say('queuedHint') },
    ] })
  }
  return { type: 'dialog', size: 'M', title: say('title'), children: children }
}

function show() { self.postMessage({ kind: 'ui-set', slot: SLOT, tree: tree() }) }

function queue(url, label) {
  state.error = null
  ask('core.queueAudioImport', { label: label, args: { url: url } }).then(function (r) {
    if (r.ok) { state.job = { id: r.body.jobId, label: label }; state.jobStatus = null; state.hits = null } else state.error = r.error.message || say('failed')
    show()
  })
}

function search() {
  var query = state.query.trim()
  if (!query) return
  // A pasted link needs no search: the add-on knows which links are its own.
  if (YOUTUBE_URL.test(query)) return queue(query, say('reference'))
  state.searching = true
  state.error = null
  show()
  ask('search', { query: query }).then(function (r) {
    state.searching = false
    if (r.ok) state.hits = r.body.hits; else { state.hits = null; state.error = r.error.message || say('failed') }
    show()
  })
}

self.onmessage = function (e) {
  var m = e.data
  if (m.type === 'init') { LANG = m.language === 'en' ? 'en' : 'de'; return }
  if (m.kind === 'update' && m.topic === 'jobs' && state.job && m.body && m.body[state.job.id]) {
    var status = m.body[state.job.id].status
    if (status && status !== state.jobStatus) { state.jobStatus = status; show() }
    return
  }
  if (m.kind === 'response') {
    var resolve = waiting[m.id]
    delete waiting[m.id]
    if (resolve) resolve(m.ok ? { ok: true, body: m.body } : { ok: false, error: m.error })
    return
  }
  if (m.kind !== 'ui-action' || m.slot !== SLOT) return
  if (m.action === 'open') {
    state = { query: (m.value && m.value.query) || '', searching: false, hits: null, error: null, job: null, jobStatus: null }
    show()
  } else if (m.action === 'change:query') {
    state.query = String(m.value || '')
  } else if (m.action === 'search') {
    search()
  } else if (m.action.indexOf('pick:') === 0) {
    var hit = state.hits && state.hits[Number(m.action.slice(5))]
    if (hit) queue(hit.url, hit.title)
  } else if (m.action === 'close') {
    ask('core.closeSlot', {})
  }
}
