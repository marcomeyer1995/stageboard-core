// The stem add-on's view script (docs/36 §6, #964): a classic script, no imports, in a Worker of the viewer's own device. It fills the slot
// `song-editor.track-action` - the dialog "Spuren trennen" of one track - with a DESCRIPTION; StageBoard draws it. It asks (`request`), StageBoard answers.
// The separation itself is the method `separate` of the work script, run on a device that has Demucs; this script only says what the person wants.
// Everything the person reads is here, in the language it was given: StageBoard knows nothing of how stems are made.
var LANG = 'de'
var TEXT = {
  de: {
    title: 'Spuren trennen: ',
    tracks: 'Spuren',
    standard: 'Standard',
    extended: 'Erweitert',
    standardHint: 'Schlagzeug, Bass, Gesang und der Rest.',
    extendedHint: 'Zusätzlich Gitarre und Keys.',
    splitGuitar: 'Zwei Gitarren trennen',
    splitGuitarInfo: 'Zwei Hauptgitarren, links und rechts im Stereobild, kommen als zwei Spuren heraus. Demucs kann zwei Gitarren nicht unterscheiden - ihre Stereoseite schon.',
    replaces: 'Die bisherigen Spuren dieses Tracks werden ersetzt.',
    runs: 'Läuft auf dem Host, etwa eine Minute je Song. Die Spuren erscheinen unter dem Track und lassen sich umbenennen.',
    go: 'Trennen',
    cancel: 'Abbrechen',
    failed: 'Das hat nicht geklappt.',
  },
  en: {
    title: 'Separate stems: ',
    tracks: 'Stems',
    standard: 'Standard',
    extended: 'Extended',
    standardHint: 'Drums, bass, vocals and the rest.',
    extendedHint: 'Also guitar and keys.',
    splitGuitar: 'Split two guitars',
    splitGuitarInfo: 'Two main guitars, left and right in the stereo image, come out as two stems. Demucs cannot tell two guitars apart - their stereo side it can.',
    replaces: 'The earlier stems of this track are replaced.',
    runs: 'Runs on the host, about a minute per song. The stems appear under the track and can be renamed.',
    go: 'Separate',
    cancel: 'Cancel',
    failed: 'That did not work.',
  },
}
function say(key) { return (TEXT[LANG] || TEXT.en)[key] }

var SLOT = 'song-editor.track-action'
var state = { trackLabel: '', hasStems: false, model: 'standard', splitGuitar: false, error: null }
var waiting = {}
var nextId = 1

function ask(method, body) {
  return new Promise(function (resolve) {
    var id = nextId++
    waiting[id] = resolve
    self.postMessage({ kind: 'request', id: id, method: method, body: body })
  })
}

function tree() {
  var children = [
    { type: 'segmented', id: 'model', options: [{ value: 'standard', label: say('standard') }, { value: 'extended', label: say('extended') }], value: state.model },
    { type: 'text', role: 'body', text: state.model === 'standard' ? say('standardHint') : say('extendedHint') },
  ]
  if (state.model === 'extended') {
    children.push({ type: 'switch', id: 'splitGuitar', label: say('splitGuitar'), value: state.splitGuitar })
    children.push({ type: 'text', role: 'hint', text: say('splitGuitarInfo') })
  }
  children.push({ type: 'text', role: 'hint', text: say('runs') + (state.hasStems ? ' ' + say('replaces') : '') })
  if (state.error) children.push({ type: 'text', role: 'error', text: state.error })
  children.push({ type: 'row', children: [
    { type: 'button', variant: 'secondary', label: say('cancel'), action: 'close' },
    { type: 'button', variant: 'primary', label: say('go'), action: 'go' },
  ] })
  return { type: 'dialog', size: 'M', title: say('title') + state.trackLabel, children: children }
}

function show() { self.postMessage({ kind: 'ui-set', slot: SLOT, tree: tree() }) }

self.onmessage = function (e) {
  var m = e.data
  if (m.type === 'init') { LANG = m.language === 'en' ? 'en' : 'de'; return }
  if (m.kind === 'response') {
    var resolve = waiting[m.id]
    delete waiting[m.id]
    if (resolve) resolve(m.ok ? { ok: true, body: m.body } : { ok: false, error: m.error })
    return
  }
  if (m.kind !== 'ui-action' || m.slot !== SLOT) return
  if (m.action === 'open') {
    var context = m.value || {}
    state = { trackLabel: String(context.trackLabel || ''), hasStems: context.hasStems === true, model: 'standard', splitGuitar: false, error: null }
    show()
  } else if (m.action === 'change:model') {
    state.model = m.value === 'extended' ? 'extended' : 'standard'
    show()
  } else if (m.action === 'change:splitGuitar') {
    state.splitGuitar = m.value === true
  } else if (m.action === 'go') {
    ask('core.queueStemSeparation', { model: state.model, splitGuitar: state.model === 'extended' && state.splitGuitar }).then(function (r) {
      if (r.ok) ask('core.closeSlot', {})
      else { state.error = (r.error && r.error.message) || say('failed'); show() }
    })
  } else if (m.action === 'close') {
    ask('core.closeSlot', {})
  }
}
