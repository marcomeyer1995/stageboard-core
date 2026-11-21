// The YouTube add-on's work script (docs/36 §7, #964): a classic script, no imports, in a sandbox on any device that has yt-dlp (a helper). It answers
// two methods over the contract (protocol 3) and holds no network handle, no file and no program: it asks StageBoard for the helper `yt-dlp`.
//   search {query}     -> {hits: [{id, title, channel, durationSec, url}]}
//   fetchAudio {url}   -> {audio, ext}        (long: reports progress through the helper)
// Everything about YouTube is here and nowhere in StageBoard: which links count, what to tell the person when it fails. StageBoard only turns the
// audio this returns into a track of the song.
var LANG = 'de'
var TEXT = {
  de: {
    urlOnly: 'Nur youtube.com/youtu.be-Links werden unterstützt.',
    queryEmpty: 'Bitte einen Suchbegriff eingeben.',
    searchTimeout: 'Die YouTube-Suche hat nicht geantwortet - ist das Gerät online?',
    downloadTimeout: function (p) { return 'yt-dlp hat nach ' + p.minutes + ' Minuten nicht fertig geladen und wurde abgebrochen.' },
    tooLarge: function (p) { return 'Die Audiospur ist größer als das Limit von ' + p.mb + ' MB.' },
    noAudio: 'YouTube bietet zu diesem Video keine ladbare Audiospur an.',
    failed: 'Der YouTube-Download ist fehlgeschlagen.',
  },
  en: {
    urlOnly: 'Only youtube.com/youtu.be links are supported.',
    queryEmpty: 'Please enter something to search for.',
    searchTimeout: 'The YouTube search did not answer - is the device online?',
    downloadTimeout: function (p) { return 'yt-dlp did not finish downloading after ' + p.minutes + ' minutes and was stopped.' },
    tooLarge: function (p) { return 'The audio is larger than the limit of ' + p.mb + ' MB.' },
    noAudio: 'YouTube offers no downloadable audio for this video.',
    failed: 'The YouTube download failed.',
  },
}
function say(key, params) { var t = (TEXT[LANG] || TEXT.en)[key]; return typeof t === 'function' ? t(params || {}) : t }

// The helper reports the failures a person should hear about as `{error: {code, params}}` - the codes are the helper's, the words are ours.
var HELPER_ERRORS = { 'youtube.downloadTimeout': 'downloadTimeout', 'youtube.tooLarge': 'tooLarge', 'youtube.noAudio': 'noAudio', 'youtube.searchTimeout': 'searchTimeout' }

var YOUTUBE_URL = /^https:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{6,}/
var waiting = {}
var nextId = 1

function helper(args, forRequest) {
  return new Promise(function (resolve, reject) {
    var id = nextId++
    waiting[id] = { resolve: resolve, reject: reject }
    self.postMessage({ kind: 'request', id: id, method: 'capability.helper', body: { helper: 'yt-dlp', args: args, files: [], forRequest: forRequest } })
  })
}
function respond(id, body) { self.postMessage({ kind: 'response', id: id, ok: true, body: body }) }
function refuse(id, code, message) { self.postMessage({ kind: 'response', id: id, ok: false, error: { code: code, message: message } }) }
function helperFailure(id, error) {
  var key = HELPER_ERRORS[error.code]
  refuse(id, key ? 'youtube.' + key : 'youtube.failed', say(key || 'failed', error.params))
}

function search(m) {
  var query = String((m.body && m.body.query) || '').trim()
  if (!query) return refuse(m.id, 'youtube.query', say('queryEmpty'))
  helper(['search', query], m.id).then(function (r) {
    if (r.result && r.result.error) return helperFailure(m.id, r.result.error)
    respond(m.id, { hits: r.result.hits })
  }, function (err) { refuse(m.id, 'youtube.failed', say('failed') + ' (' + err.message + ')') })
}

function fetchAudio(m) {
  var url = String((m.body && m.body.url) || '').trim()
  if (!YOUTUBE_URL.test(url)) return refuse(m.id, 'youtube.urlOnly', say('urlOnly'))
  helper(['download', url], m.id).then(function (r) {
    if (r.result && r.result.error) return helperFailure(m.id, r.result.error)
    if (!r.files.length) return refuse(m.id, 'youtube.failed', say('failed'))
    respond(m.id, { audio: r.files[0].bytes, ext: (r.result && r.result.ext) || '' })
  }, function (err) { refuse(m.id, 'youtube.failed', say('failed') + ' (' + err.message + ')') })
}

self.onmessage = function (e) {
  var m = e.data
  if (m.type === 'init') { LANG = m.language === 'en' ? 'en' : 'de'; return }
  if (m.kind === 'response') {
    var w = waiting[m.id]
    delete waiting[m.id]
    if (w) { if (m.ok) w.resolve(m.body); else w.reject(new Error(m.error.message)) }
  } else if (m.kind === 'request') {
    if (m.method === 'search') search(m)
    else if (m.method === 'fetchAudio') fetchAudio(m)
    else refuse(m.id, 'method.unknown', 'Unknown method ' + m.method)
  }
}
