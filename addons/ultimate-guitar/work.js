// The Ultimate Guitar add-on (docs/32 §6, #964): a classic Worker script, no imports, in a sandbox. It answers `search` and `fetchDetail`.
// EVERYTHING about Ultimate Guitar is in this file and nowhere in StageBoard: which entries are importable and in which order, how a tab's markup
// (`[ch]G[/ch]`, `[tab]`, section headers) becomes ChordPro, and the words the musician reads when UG is unreachable or has changed its site. A band
// that did not install this add-on carries none of it. When UG changes its site, THIS file is what gets updated.
// The page itself is read by the device's helper `ug-page` (a real Chrome - UG sits behind Cloudflare; an add-on starts no program, so it asks).
// The helper reports a failure as a code (`chrome-missing`, `timeout`, ...); the add-on says it in words.
var LANG = 'de'
var TEXT = {
  de: {
    chromePathWrong: function (p) { return 'CHROME_EXECUTABLE_PATH zeigt auf „' + p.path + '“ - dort ist kein Chrome/Chromium. Pfad korrigieren oder die Variable entfernen.' },
    chromeMissing: function (p) { return 'Für Ultimate Guitar braucht dieses Gerät Chrome oder Chromium - keins gefunden (gesucht: ' + p.paths + '). Installieren, z. B. „sudo apt install chromium“.' },
    timeout: function (p) { return 'Ultimate Guitar antwortet nicht (' + p.seconds + ' s). Internetverbindung des Geräts prüfen und noch einmal versuchen.' },
    unavailable: function () { return 'Ultimate Guitar ist nicht erreichbar - hat das Gerät gerade Internet?' },
    blocked: function () { return 'Ultimate Guitar hat die Anfrage als Bot blockiert. In ein paar Minuten noch einmal versuchen.' },
    sourceChanged: function (p) { return 'Ultimate Guitar hat seine Seite umgebaut (Seitentitel: „' + p.title + '“) - dieses Add-on muss angepasst werden.' },
    notImportable: function () { return 'Diese Version hat keinen Text zum Übernehmen (z. B. eine Pro- oder Video-Version). Bitte eine andere Version wählen.' },
  },
  en: {
    chromePathWrong: function (p) { return 'CHROME_EXECUTABLE_PATH points to "' + p.path + '" - there is no Chrome/Chromium there. Fix the path or remove the variable.' },
    chromeMissing: function (p) { return 'Ultimate Guitar needs Chrome or Chromium on this device - none found (looked in: ' + p.paths + '). Install one, e.g. "sudo apt install chromium".' },
    timeout: function (p) { return 'Ultimate Guitar is not answering (' + p.seconds + ' s). Check the device\'s internet connection and try again.' },
    unavailable: function () { return 'Ultimate Guitar is unreachable - does the device have internet?' },
    blocked: function () { return 'Ultimate Guitar blocked the request as a bot. Try again in a few minutes.' },
    sourceChanged: function (p) { return 'Ultimate Guitar rebuilt its site (page title: "' + p.title + '") - this add-on needs an update.' },
    notImportable: function () { return 'This version has no text to import (e.g. a Pro or video version). Please pick another version.' },
  },
}
function say(key, params) { return (TEXT[LANG] || TEXT.en)[key](params || {}) }
// A failure ends the call with a code the app can tell apart (`blocked`, `timeout`, ...) and the words for it.
var HELPER_CODES = { 'chrome-path-wrong': ['no-browser', 'chromePathWrong'], 'chrome-missing': ['no-browser', 'chromeMissing'], timeout: ['timeout', 'timeout'], unavailable: ['unavailable', 'unavailable'] }
function fail(code, key, params) { return { __fail: { code: code, message: say(key, params) } } }
function missingData(title) {
  if (/just a moment|attention required|cloudflare|access denied/i.test(title)) return fail('blocked', 'blocked')
  return fail('source-changed', 'sourceChanged', { title: title || '-' })
}

// ---- Ultimate Guitar's chord-sheet markup -> ChordPro (was in StageBoard's shared-types; it is UG's business, not StageBoard's) ----
const CHORD_TAG_RE = /\[ch\]([^[]*)\[\/ch\]/g;
/** A chord symbol UG forgot to wrap in `[ch]` (seen live: `Em7add#5`, `G13sus4/E` on Hotel
 * California's chord lines). Deliberately strict - a root plus only chord-quality vocabulary -
 * so ordinary words ("Be", "Go", "Am I") don't pass as chords. Only ever consulted on a line
 * that already has at least one tagged chord. */
const UNTAGGED_CHORD_RE = /^[A-G][#b]?(?:maj|min|dim|aug|sus|add|m|M|\+|°|ø|[#b]|\d+)*(?:\/[A-G][#b]?)?$/;
/** `x4`, `2x`, `(x2)` - how often a chord line repeats. */
const REPEAT_MARK_RE = /^\(?(?:x\s?\d+|\d+\s?x)\)?,?$/i;
/** "No chord" - kept as a chord symbol (`[N.C.]`), a common ChordPro convention that
 * transposeChord already leaves untouched. */
const NO_CHORD_RE = /^N\.?C\.?$/i;
/** Bar lines and similar layout characters between chords (`| C | F |`, `C - G`, `C / / /`). */
const DECORATION_RE = /^[|\-/.*:%>~,]+$/;
/** The line with every `[ch]X[/ch]` replaced by `X`, plus each tagged chord's column in that
 * stripped line - the column that lines it up against the lyric line beneath. */
function stripChordTags(line) {
    const tagged = [];
    let stripped = '';
    let lastIndex = 0;
    CHORD_TAG_RE.lastIndex = 0;
    let match;
    while ((match = CHORD_TAG_RE.exec(line)) !== null) {
        stripped += line.slice(lastIndex, match.index);
        // The chord name itself still occupies columns in the untagged line - only the [ch]/[/ch]
        // wrapper disappears - so it counts toward where the *next* chord's gap starts.
        tagged.push({ pos: stripped.length, chord: match[1] });
        stripped += match[1];
        lastIndex = CHORD_TAG_RE.lastIndex;
    }
    return { stripped: stripped + line.slice(lastIndex), tagged };
}
/**
 * Parses a line UG marked with at least one `[ch]` tag as a chord line: every chord (tagged or
 * not) and every annotation with its column. `null` when anything on the line is neither a
 * chord, a repeat mark, a parenthetical comment nor layout - i.e. real text with a chord tag
 * embedded, which must not be treated as a chord line (nor spliced into as a lyric).
 */
function parseChordLine(line) {
    if (!line.includes('[ch]'))
        return null;
    const { stripped, tagged } = stripChordTags(line);
    const tokens = [];
    // A parenthetical group is one token even with spaces inside ("(x3, very short)").
    const TOKEN_RE = /\([^()]*\)|\S+/g;
    let match;
    while ((match = TOKEN_RE.exec(stripped)) !== null) {
        const text = match[0];
        const start = match.index;
        const end = start + text.length;
        const chordsInside = tagged.filter((t) => t.pos >= start && t.pos < end);
        if (chordsInside.length > 0) {
            // A tagged chord, possibly wrapped in layout like "(C)" or "|C|". Whatever surrounds the
            // chord names has to be layout, or this isn't a clean chord token.
            let rest = text;
            for (const chord of chordsInside)
                rest = rest.replace(chord.chord, '');
            if (rest !== '' && !/^[|()\-/.*:~,]+$/.test(rest))
                return null;
            // "(C)" sits where its "(" is - that's the column UG aligned against the lyric, so a
            // single wrapped chord takes the token's start (else "(C)" over "Say" gave "S[C]ay").
            for (const chord of chordsInside) {
                tokens.push({ pos: chordsInside.length === 1 ? start : chord.pos, sourcePos: chord.pos, text: chord.chord, kind: 'chord' });
            }
            if (rest !== '')
                tokens.push({ pos: start, sourcePos: start, text: rest, kind: 'decoration' });
        }
        else if (UNTAGGED_CHORD_RE.test(text) || NO_CHORD_RE.test(text)) {
            tokens.push({ pos: start, sourcePos: start, text, kind: 'chord' });
        }
        else if (REPEAT_MARK_RE.test(text) || /^\(.*\)$/.test(text)) {
            tokens.push({ pos: start, sourcePos: start, text, kind: 'annotation' });
        }
        else if (DECORATION_RE.test(text)) {
            tokens.push({ pos: start, sourcePos: start, text, kind: 'decoration' });
        }
        else {
            return null;
        }
    }
    return { stripped, tokens };
}
/** Square brackets that are part of the *text* ("[Radar Love].(Unspoken)", "[Ike] Left a good
 * job...") - in ChordPro every `[...]` is a chord, so they'd turn into bogus chords or, once real
 * chords are spliced in, into nested garbage like `[Radar [F#m7]Love]`. They become parentheses;
 * UG's own `[ch]` tags are left alone for the caller to convert. */
function neutralizeTextBrackets(line) {
    return line
        .split(/(\[ch\][^[]*\[\/ch\])/)
        .map((part, index) => (index % 2 === 1 ? part : part.replace(/\[/g, '(').replace(/\]/g, ')')))
        .join('');
}
/** Merges a chord line's chords into the lyric line beneath it, at the same column offsets -
 * UG positions chords above lyrics by whitespace alignment; StageBoard's ChordPro wants them
 * inline (`[G]text`). Annotations (repeat marks, comments) go to the end of the line; layout
 * characters (bars, parentheses around a chord) are dropped. */
function spliceChordsIntoLyric(lyricLine, tokens) {
    let result = '';
    let cursor = 0;
    for (const { pos, text } of tokens.filter((t) => t.kind === 'chord')) {
        const clamped = Math.max(cursor, Math.min(pos, lyricLine.length));
        result += lyricLine.slice(cursor, clamped) + `[${text}]`;
        cursor = clamped;
    }
    result += lyricLine.slice(cursor);
    const annotations = tokens.filter((t) => t.kind === 'annotation').map((t) => t.text);
    return annotations.length > 0 ? `${result}  ${annotations.join(' ')}` : result;
}
/** A chord line with no lyric beneath it (an intro, bar lines, a riff marker) stays a line of
 * its own: every chord becomes `[X]` in place, everything else - spacing, bars, repeat marks,
 * comments - is kept as written. */
function chordLineToInline(stripped, tokens) {
    let result = '';
    let cursor = 0;
    for (const { sourcePos, text } of tokens.filter((t) => t.kind === 'chord')) {
        result += stripped.slice(cursor, sourcePos) + `[${text}]`;
        cursor = sourcePos + text.length;
    }
    return result + stripped.slice(cursor);
}
/** One string of a guitar tab staff: a string name (`e`, `B`, `Gb`, ...), a `|`, then frets and
 * dashes (`e|---5-2---|`, `D|---0-0---| x2`). */
function isStaffLine(line) {
    return !line.includes('[ch]') && /^\s*[A-Ga-g][#b]?\s?\|.*-{2,}/.test(line);
}
/** The beat-count line UG puts under a riff (`   3 + 4 + 1 + 2 +`). */
function isCountingLine(line) {
    return /\d/.test(line) && /^[\s\d+&.|]+$/.test(line);
}
/**
 * A guitar tab block starting at `start`: an optional chord line naming the chords above the
 * fret columns, two or more staff lines, and an optional counting line below. Returns the
 * block's lines - verbatim, only UG's chord tags stripped so the names keep their columns - and
 * the index after it; null when `start` doesn't open one. Found on 9 of 29 real repertoire tabs
 * (2026-09-26): before, the chord line was spliced *into* the first staff line as if it were a
 * lyric, garbling the riff.
 */
function tabBlockAt(lines, start) {
    var _a, _b;
    let i = start;
    const block = [];
    if (!isStaffLine((_a = lines[i]) !== null && _a !== void 0 ? _a : '') && parseChordLine((_b = lines[i]) !== null && _b !== void 0 ? _b : '') !== null) {
        block.push(stripChordTags(lines[i]).stripped.trimEnd());
        i += 1;
    }
    let staffLines = 0;
    while (i < lines.length && isStaffLine(lines[i])) {
        block.push(lines[i].trimEnd());
        staffLines += 1;
        i += 1;
    }
    if (staffLines < 2)
        return null;
    if (i < lines.length && isCountingLine(lines[i])) {
        block.push(lines[i].trimEnd());
        i += 1;
    }
    return { block, next: i };
}
/** `[Verse 1]`, `[Intro]`, `[Chorus]` - a bracketed token starting the line that isn't one of
 * UG's own markup tags - plus whatever note follows it on the same line (`[Chorus] (x4)`,
 * `[Intro] (G in riff is really G5)`, `[Spoken]   [Ike singing]`; found on 5 of 29 real tabs,
 * 2026-09-26). Before, such a line wasn't a section at all, and the ChordPro parser then read
 * "[Chorus]" as a *chord*. The note has its own brackets stripped. */
function sectionLabel(line) {
    const match = line.trim().match(/^\[([^\]]+)\](.*)$/);
    if (!match)
        return null;
    if (/^\/?(ch|tab)$/.test(match[1]) || match[2].includes('[ch]'))
        return null;
    const rest = match[2].trim();
    // Only note shapes seen on real tabs - a parenthetical, a repeat mark, another bracketed
    // label. Anything else ("[Ike] Left a good job...") is a lyric line that happens to start
    // with a bracket, and must stay a lyric rather than be demoted to a comment.
    if (rest !== '' && !/^(\(.*\)|\[[^\]]*\]|x\s?\d+|\d+\s?x)$/i.test(rest))
        return null;
    return { label: match[1], note: rest.replace(/[[\]]/g, '').trim() };
}
/**
 * Converts Ultimate Guitar's chord-sheet markup (`[ch]G[/ch]` tags on their own line above
 * the lyrics, `[Verse 1]` section headers, `[tab]...[/tab]` wrapping both) into StageBoard's
 * ChordPro (`[G]text` inline, `{part: Verse 1}` directives - see chordpro.ts). Pure and unit
 * tested against real content pulled from live tab pages; no network involved here.
 *
 * Chord lines are more than bare tags in practice (found on real tabs, 2026-09-26): bar lines
 * (`| C | F |`), chords in parentheses, repeat marks (`x4`), comments (`(Cesura)`) and chord
 * names UG left untagged - see `parseChordLine`. Guitar tab riffs become ChordPro tab blocks
 * (`{start_of_tab}` ... `{end_of_tab}`, for everyone) - see `tabBlockAt`. Whatever still carries a `[ch]` tag at the end
 * (a chord embedded in real text) is reduced to `[X]`, so raw UG markup never reaches a song.
 */
function convertUltimateGuitarContent(raw) {
    const rawLines = raw.replace(/\r\n/g, '\n').split('\n').map((line) => line.replace(/\[\/?tab\]/g, ''));
    const output = [];
    let i = 0;
    while (i < rawLines.length) {
        const line = rawLines[i];
        const section = sectionLabel(line);
        if (section !== null) {
            output.push(`{part: ${section.label}}`);
            if (section.note !== '')
                output.push(`{c: ${section.note}}`);
            i += 1;
            continue;
        }
        // Before chord lines: a chord line directly above a riff belongs to the tab block.
        const tab = tabBlockAt(rawLines, i);
        if (tab) {
            output.push('{start_of_tab}', ...tab.block, '{end_of_tab}');
            i = tab.next;
            continue;
        }
        const chordLine = parseChordLine(line);
        if (chordLine) {
            const next = rawLines[i + 1];
            // A line that still carries chord tags is never a lyric to splice into - that produced
            // `[Am][ch[E7]]F[/...` garbage when two chord lines followed each other.
            const nextIsLyric = next !== undefined && next.trim() !== '' && !next.includes('[ch]') && sectionLabel(next) === null;
            if (nextIsLyric) {
                output.push(spliceChordsIntoLyric(neutralizeTextBrackets(next), chordLine.tokens));
                i += 2;
            }
            else {
                output.push(chordLineToInline(chordLine.stripped, chordLine.tokens));
                i += 1;
            }
            continue;
        }
        output.push(neutralizeTextBrackets(line).replace(CHORD_TAG_RE, '[$1]'));
        i += 1;
    }
    return output.join('\n');
}

// ---- the add-on ----
var NOT_IMPORTABLE = { Pro: 1, Official: 1, Video: 1 }
var pending = {}
var nextRequest = 1

// How sure the community is about a version: its stars, pulled towards an average 4.0 while it has few votes (Bayesian average, weight 50 votes).
function score(rating, votes) {
  if (rating === undefined || rating === null) return -1
  var v = Math.max(0, votes || 0)
  return (v * rating + 50 * 4) / (v + 50)
}

// The page is read by the device's helper `ug-page` (a real Chrome); `then` turns what it saw into the answer - or into a failure with a code and our words.
function ask(id, url, then) {
  var request = nextRequest++
  pending[request] = { id: id, then: then }
  self.postMessage({ kind: 'request', id: request, method: 'capability.helper', body: { helper: 'ug-page', args: [url], files: [] } })
}

function finish(id, outcome) {
  if (outcome && outcome.__fail) self.postMessage({ kind: 'response', id: id, ok: false, error: { code: outcome.__fail.code, message: outcome.__fail.message } })
  else self.postMessage({ kind: 'response', id: id, ok: true, body: outcome })
}

self.onmessage = function (e) {
  var m = e.data
  if (m.type === 'init') {
    LANG = m.language === 'en' ? 'en' : 'de'
  } else if (m.kind === 'request' && m.method === 'search') {
    ask(m.id, 'https://www.ultimate-guitar.com/search.php?search_type=title&value=' + encodeURIComponent(String(m.body.query || '')), function (page) {
      if (!page.hasData) return missingData(page.title)
      // Entries with no `type` are the paid "official"/"TabPro" listings. "Pro"/"Official"/"Video" have no plain text to import - excluded upfront
      // rather than left to fail after the musician picked one. Best-rated first.
      var results = ((page.data || {}).results || []).filter(function (r) { return typeof r.type === 'string' && r.type.length > 0 && !NOT_IMPORTABLE[r.type] })
      results.sort(function (a, b) { return score(b.rating, b.votes) - score(a.rating, a.votes) })
      return results.map(function (r) {
        // The id carries the whole URL: the add-on keeps nothing between calls.
        var o = { id: r.id + '::' + r.tab_url, title: r.song_name, subtitle: [r.artist_name, r.type, r.tonality_name].filter(Boolean).join(' · '), sourceUrl: r.tab_url }
        if (typeof r.rating === 'number') o.rating = Math.round(r.rating * 100) / 100
        if (typeof r.votes === 'number') o.votes = r.votes
        return o
      })
    })
  } else if (m.kind === 'request' && m.method === 'fetchDetail') {
    var id = String(m.body.id || '')
    var sep = id.indexOf('::')
    if (sep === -1) return self.postMessage({ kind: 'response', id: m.id, ok: false, error: { code: 'lookup.bad-id', message: 'Malformed ultimate-guitar-scraper result id: ' + id } })
    var tabUrl = id.slice(sep + 2)
    ask(m.id, tabUrl, function (page) {
      if (!page.hasData) return missingData(page.title)
      var data = page.data || {}, view = data.tab_view || {}, meta = view.meta || {}, tab = data.tab || {}, tuning = meta.tuning || {}
      var content = (view.wiki_tab && view.wiki_tab.content) || null
      if (!content) return fail('not-importable', 'notImportable')
      var strumming = view.strummings && view.strummings[0]
      return {
        title: tab.song_name || null, artist: tab.artist_name || null,
        key: meta.tonality || tab.tonality_name || null,
        tuning: tuning.value || tuning.name || null,
        capo: meta.capo === undefined ? null : meta.capo,
        bpm: strumming && strumming.bpm !== undefined ? strumming.bpm : null,
        sourceUrl: tabUrl,
        chordProContent: convertUltimateGuitarContent(content),
      }
    })
  } else if (m.kind === 'response') {
    var p = pending[m.id]
    delete pending[m.id]
    if (!p) return
    if (!m.ok) return self.postMessage({ kind: 'response', id: p.id, ok: false, error: { code: 'lookup.failed', message: m.error.message } })
    var result = m.body.result
    if (result && result.error) {
      var known = HELPER_CODES[result.error.code]
      return finish(p.id, known ? fail(known[0], known[1], result.error.params) : { __fail: { code: 'failed', message: String(result.error.code) } })
    }
    try { finish(p.id, p.then(result)) }
    catch (err) { self.postMessage({ kind: 'response', id: p.id, ok: false, error: { code: 'lookup.failed', message: String(err && err.message || err) } }) }
  } else if (m.kind === 'request') {
    self.postMessage({ kind: 'response', id: m.id, ok: false, error: { code: 'method.unknown', message: 'Unknown method ' + m.method } })
  }
}
