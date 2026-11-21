// The OSC add-on's view script (docs/36 §5a, §6, #964): a classic script, no imports, in a Worker of the viewer's own device. It fills the slot `device.panel`
// of an OSC device with a DESCRIPTION: what was last sent to it. The value is not asked for - it is a `{bind}` to the device's live state, which StageBoard
// keeps and keeps current (the work script publishes `lastCue` after every cue). So this script only says how it looks.
var LANG = 'de'
var TEXT = { de: { title: 'OSC', last: 'Zuletzt gesendet', none: 'Noch nichts gesendet' }, en: { title: 'OSC', last: 'Last sent', none: 'Nothing sent yet' } }
function say(key) { return (TEXT[LANG] || TEXT.en)[key] }
var SLOT = 'device.panel'

self.onmessage = function (e) {
  var m = e.data
  if (m.type === 'init') { LANG = m.language === 'en' ? 'en' : 'de'; return }
  if (m.kind !== 'ui-action' || m.slot !== SLOT || m.action !== 'open') return
  var device = String((m.value && m.value.device) || '')
  self.postMessage({ kind: 'ui-set', slot: SLOT, tree: { type: 'card', children: [
    { type: 'text', role: 'hint', text: say('last') },
    { type: 'text', role: 'body', text: { bind: 'state:' + device + '.lastCue' } },
  ] } })
}
