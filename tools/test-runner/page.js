// Injected into the app's page on every device (run.mjs): small helpers the checks call through
// CDP as window.__sbt.*. Plain browser JS, no imports. It only reads and taps - it never types.
window.__sbt = {
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

  /** The status bar's text - mode, song, time, who. */
  header() {
    return document.querySelector('header,[role=banner]')?.textContent ?? ''
  },

  /** The song position "m:ss" from the status bar, or null. */
  position() {
    return window.__sbt.header().match(/(\d+:\d\d) \//)?.[1] ?? null
  },

  // Laid out and not hidden on purpose (the status bar ranks its items and hides what does not
  // fit with visibility: hidden, #429).
  visible: (el) => !!el && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed') && getComputedStyle(el).visibility !== 'hidden',

  /** Every name a control goes by: aria-label, its text, the label of its icon (<Icon label=…>),
   * its title (a Segmented option's title is its explanation, not its name - so all of them). */
  namesOf(b) {
    return [b.getAttribute('aria-label'), b.textContent, b.querySelector('[aria-label]')?.getAttribute('aria-label'), b.title].map((n) => (n ?? '').trim()).filter(Boolean)
  },

  /** A visible button by one of its names. */
  button(name) {
    return [...document.querySelectorAll('button,[role=button],[role=tab],[role=radio]')].find((b) => window.__sbt.visible(b) && window.__sbt.namesOf(b).includes(name))
  },

  click(name) {
    const b = window.__sbt.button(name)
    if (!b) return false
    b.click()
    return true
  },

  /** ☰ → a view (Boards, Bibliothek, System). */
  async view(name) {
    window.__sbt.click('Menü öffnen')
    await window.__sbt.wait(700)
    const ok = window.__sbt.click(name)
    if (!ok) window.__sbt.click('Fertig')
    await window.__sbt.wait(1200)
    return ok
  },

  /** ☰ → Modus Gig or Solo Üben. */
  async mode(name) {
    window.__sbt.click('Menü öffnen')
    await window.__sbt.wait(700)
    const ok = window.__sbt.click(name)
    window.__sbt.click('Fertig')
    await window.__sbt.wait(800)
    return ok
  },

  /** The System tabs as shown (top row or side list). */
  systemTabs() {
    return [...document.querySelectorAll('[role=tab]')].filter(window.__sbt.visible).map((t) => t.textContent.trim())
  },

  /** The transport of the Boards view, by name. */
  transport(which) {
    return window.__sbt.click({ play: 'Play', pause: 'Pause', stop: 'Stop' }[which])
  },

  /** Steps through the songs (Solo, no setlist: the catalogue) until the status bar names
   * `title` - forward first, then back. */
  async openSong(title) {
    for (const dir of ['Nächster Song', 'Vorheriger Song']) {
      for (let i = 0; i < 40; i++) {
        if (window.__sbt.header().includes(title)) return true
        const b = window.__sbt.button(dir)
        if (!b || b.disabled) break
        b.click()
        await window.__sbt.wait(400)
      }
    }
    return window.__sbt.header().includes(title)
  },

  /** A text element whose own text starts with `start` (a line of the song), tapped. */
  tapText(start) {
    const el = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent.trim().startsWith(start))
    if (!el) return false
    el.scrollIntoView({ block: 'center' })
    el.click()
    return true
  },

  /**
   * What looks broken on this screen (docs/15, Marco: "keine abgeschnittenen Texte, auf allen
   * Gerätegrößen sauber"). Errors: text cut off, content past the right edge, the page scrolling
   * sideways. Warnings: touch targets and text below the size of the screen's tier (docs/15):
   * 'stage' (Boards, played during the song) 48 px / 16 px, 'prep' (Bibliothek, System -
   * preparation, may be denser) 40 px / 14 px. Content clipped by a box that hides its overflow
   * counts once per box ("Statusleiste: 5 cut off"), not once per hidden item.
   */
  gui(tier = 'stage') {
    // Phone (< 600 px wide, Marco 2026-11-13): text may be a step smaller there - the screen is
    // small. Touch targets stay: the finger is not smaller on a phone.
    const phone = document.documentElement.clientWidth < 600
    const [minTarget, minText] = tier === 'stage' ? [47.5, phone ? 13.5 : 15.5] : [39.5, phone ? 11.5 : 13.5]
    const vw = document.documentElement.clientWidth
    const out = []
    const scrollsX = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX
        if (o === 'auto' || o === 'scroll') return true
      }
      return false
    }
    // The nearest box that cuts off what sticks out of it.
    const clipper = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p)
        if (cs.overflowX === 'hidden' || cs.overflow === 'hidden' || cs.overflowX === 'clip') return p
      }
      return null
    }
    const clipped = new Map()
    const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 60)
    const seen = new Set()
    const add = (kind, severity, el, extra = {}) => {
      const key = `${kind}|${label(el)}`
      if (seen.has(key)) return
      seen.add(key)
      out.push({ kind, severity, text: label(el), ...extra })
    }
    for (const el of document.querySelectorAll('body *')) {
      if (!window.__sbt.visible(el) || el.closest('svg')) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const cs = getComputedStyle(el)
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      // Up to a space's width over the edge is a hanging space of a wrapped line (pre-wrap), no glyph.
      const slack = parseFloat(cs.fontSize) * 0.65
      const cutHere = ownText && el.scrollWidth > el.clientWidth + 1 && (cs.textOverflow === 'ellipsis' || cs.overflowX === 'hidden' || cs.overflow === 'hidden')
      // A text that scrolls through once and then rests with "…" is cut on purpose (#373).
      if (cutHere) add('cut', el.closest('[data-scroll-once]') ? 'note' : 'error', el, { width: Math.round(el.clientWidth), needs: el.scrollWidth })
      if (ownText && !cutHere && !scrollsX(el)) {
        // Where the text ends, not the box - a full-width block is not cut because its box is.
        // Only its own text: a hidden child (the status bar's "/ 2:11", hidden by rank) does not count.
        let right = -Infinity
        for (const n of el.childNodes) {
          if (n.nodeType !== 3 || !n.textContent.trim()) continue
          const range = document.createRange()
          range.selectNodeContents(n)
          right = Math.max(right, range.getBoundingClientRect().right)
        }
        const tr = { right }
        const box = clipper(el)
        const edge = box ? Math.min(box.getBoundingClientRect().right, vw) : vw
        // Grouped by the landmark it sits in (the status bar), else by the clipping box.
        const group = el.closest('header,[role=banner],nav,[role=tablist],[role=dialog]') ?? box
        if (el.closest('[data-scroll-once]')) {
          // cut on purpose, see above
        } else if (tr.right > edge + slack && box) clipped.set(group, [...(clipped.get(group) ?? []), label(el)])
        else if (tr.right > vw + slack) add('off-screen', 'error', el, { right: Math.round(tr.right), viewport: vw })
      }
      // A control cut at the top or bottom by the box around it (a widget too low for its content).
      if (el.matches('button,[role=button],[role=tab],[role=radio],a[href],select')) {
        for (let p = el.parentElement; p; p = p.parentElement) {
          const o = getComputedStyle(p).overflowY
          if (o === 'visible') continue
          // A preparation screen scrolls: a control half below the fold is fine there. On Boards
          // nothing may scroll (dashboards never scroll), so a scrolling box counts too.
          if (tier !== 'stage' && (o === 'auto' || o === 'scroll')) break
          const pr = p.getBoundingClientRect()
          const cut = Math.max(0, r.bottom - pr.bottom, pr.top - r.top)
          if (cut > 2 && cut < r.height) add('control-cut', tier === 'stage' ? 'error' : 'warning', el, { cut: Math.round(cut) })
          break
        }
      }
      if (el.matches('button,[role=button],[role=tab],[role=radio],[role=switch],a[href],select') && (r.height < minTarget || r.width < minTarget))
        add('small-target', 'warning', el, { size: `${Math.round(r.width)}×${Math.round(r.height)}` })
      if (ownText && parseFloat(cs.fontSize) < minText) add('small-text', 'warning', el, { px: parseFloat(cs.fontSize) })
    }
    const area = (el) => (el.matches('header,[role=banner]') ? 'status bar' : el.getAttribute('aria-label') || el.getAttribute('role') || el.tagName.toLowerCase())
    for (const [group, items] of clipped) {
      const leaves = [...new Set(items.filter((t) => t && !/^[A-Z]+$/.test(t)))]
      out.push({ kind: 'clipped', severity: 'error', text: `${area(group)}: ${leaves.length} cut off (${leaves.slice(0, 6).join(', ')})` })
    }
    if (document.documentElement.scrollWidth > vw + 1) out.push({ kind: 'page-scrolls-sideways', severity: 'error', text: `${document.documentElement.scrollWidth} > ${vw}` })
    return { viewport: `${vw}×${document.documentElement.clientHeight}`, problems: out }
  },
}
'ok'
