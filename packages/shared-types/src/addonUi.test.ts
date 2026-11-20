import { describe, expect, it } from 'vitest'
import { UI_LIMITS, validateUiTree } from './addonUi.js'

const ctx = { imageOrigins: ['https://i.ytimg.com'] }
const text = (t: string) => ({ type: 'text', role: 'body', text: t })

/** The YouTube search dialog of docs/36 §7. */
const youtubeDialog = {
  type: 'dialog', size: 'M', title: 'From YouTube',
  children: [
    { type: 'row', children: [{ type: 'field', id: 'query', label: 'Search', value: '' }, { type: 'button', variant: 'primary', label: 'Search', action: 'search' }] },
    { type: 'list', children: [
      { type: 'listRow', title: 'Wonderwall', subtitle: '4:18', image: { src: 'https://i.ytimg.com/vi/x/default.jpg', role: 'thumb' }, action: 'pick:x' },
      { type: 'listRow', title: 'Running…', trailing: { type: 'progress', value: { bind: 'job:abc.progress' } } },
    ] },
  ],
}

describe('validateUiTree (#964, docs/36 §6)', () => {
  it('accepts the YouTube search dialog: fields, buttons, a list with a thumbnail, a bound progress', () => {
    expect(validateUiTree(youtubeDialog, ctx)).toMatchObject({ ok: true })
  })

  it('every vocabulary node of v1 is accepted in a plausible shape', () => {
    const nodes = [
      { type: 'section', title: 'S', children: [text('a')] }, { type: 'card', children: [] }, { type: 'stack', children: [] }, { type: 'row', children: [] },
      { type: 'text', role: 'error', text: 'x' }, { type: 'text', role: 'title', text: { bind: 'state:qlc.scene' } },
      { type: 'textarea', id: 't', label: 'T' }, { type: 'select', id: 's', label: 'S', options: [{ value: 'a', label: 'A' }], value: 'a' },
      { type: 'slider', id: 'v', label: 'V', min: 0, max: 1, step: 0.1, value: { bind: 'state:qlc.level' } }, { type: 'switch', id: 'w', label: 'W', value: true },
      { type: 'segmented', id: 'g', options: [{ value: 'a', label: 'A' }], value: 'a' }, { type: 'chips', id: 'c', options: [{ value: 'a', label: 'A' }], value: ['a'] },
      { type: 'checkRow', id: 'k', label: 'K', value: false }, { type: 'iconButton', icon: 'search', label: 'Search', action: 'go' },
      { type: 'image', src: 'https://i.ytimg.com/a.jpg', role: 'cover' }, { type: 'badge', text: 'new' }, { type: 'statusDot', status: 'online' },
    ]
    for (const node of nodes) expect(validateUiTree(node, ctx), JSON.stringify(node)).toMatchObject({ ok: true })
  })

  it('rejects an unknown node with its path - an iframe, a script, a custom element', () => {
    for (const bad of [{ type: 'iframe', src: 'https://evil.example' }, { type: 'script', text: 'alert(1)' }, { type: 'my-widget' }]) {
      expect(validateUiTree({ type: 'stack', children: [text('ok'), bad] }, ctx)).toEqual({ ok: false, code: 'ui.unknown-node', path: 'children[1]' })
    }
  })

  it('rejects a tree deeper than 8 levels', () => {
    let node: unknown = text('leaf')
    for (let i = 0; i < UI_LIMITS.maxDepth; i++) node = { type: 'stack', children: [node] }
    expect(validateUiTree(node, ctx)).toMatchObject({ ok: false, code: 'ui.too-deep' })
    let fits: unknown = text('leaf')
    for (let i = 0; i < UI_LIMITS.maxDepth - 1; i++) fits = { type: 'stack', children: [fits] }
    expect(validateUiTree(fits, ctx)).toMatchObject({ ok: true })
  })

  it('rejects more than 500 nodes, and accepts exactly 500', () => {
    const many = (n: number) => ({ type: 'stack', children: Array.from({ length: n - 1 }, () => text('x')) })
    expect(validateUiTree(many(500), ctx)).toMatchObject({ ok: true })
    expect(validateUiTree(many(501), ctx)).toMatchObject({ ok: false, code: 'ui.too-many-nodes' })
  })

  it('rejects a tree above 64 KB before looking inside it', () => {
    const big = { type: 'text', role: 'body', text: 'x'.repeat(UI_LIMITS.maxBytes) }
    expect(validateUiTree(big, ctx)).toEqual({ ok: false, code: 'ui.too-large', path: '' })
  })

  it('text is plain text: markup stays literal and no node carries HTML', () => {
    const result = validateUiTree(text('<b onclick="x()">hi</b>'), ctx)
    expect(result).toMatchObject({ ok: true, tree: { text: '<b onclick="x()">hi</b>' } })
    expect(validateUiTree({ type: 'text', role: 'body', text: 'a', html: '<b>b</b>' }, ctx)).toMatchObject({ ok: false, code: 'ui.invalid' })
  })

  it('an image comes only from an origin the add-on declared - not another host, not a data: or javascript: URL, not a credentials trick', () => {
    for (const src of ['https://evil.example/a.jpg', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'https://i.ytimg.com@evil.example/a.jpg', 'http://i.ytimg.com/a.jpg', 'not a url']) {
      expect(validateUiTree({ type: 'image', src, role: 'thumb' }, ctx), src).toMatchObject({ ok: false, code: 'ui.image-origin' })
    }
    expect(validateUiTree({ type: 'listRow', title: 'x', image: { src: 'https://evil.example/a.jpg', role: 'thumb' } }, ctx)).toMatchObject({ ok: false, code: 'ui.image-origin', path: 'image' })
  })

  it('a node with a wrong prop is invalid with its path; a bind must look like a bind', () => {
    expect(validateUiTree({ type: 'stack', children: [{ type: 'button', variant: 'huge', label: 'x', action: 'a' }] }, ctx)).toEqual({ ok: false, code: 'ui.invalid', path: 'children[0]' })
    expect(validateUiTree({ type: 'progress', value: { bind: 'anything goes' } }, ctx)).toMatchObject({ ok: false, code: 'ui.invalid' })
    expect(validateUiTree({ type: 'progress', value: { bind: 'job:abc.progress' } }, ctx)).toMatchObject({ ok: true })
  })

  it('something that is no object at all is invalid, not a crash', () => {
    for (const junk of [null, 42, 'x', [], undefined]) expect(validateUiTree(junk, ctx)).toMatchObject({ ok: false })
  })

  it('a cyclic tree cannot hang or crash the validator', () => {
    const a: Record<string, unknown> = { type: 'stack', children: [] }
    ;(a.children as unknown[]).push(a)
    expect(validateUiTree(a, ctx)).toMatchObject({ ok: false })
  })
})

describe('link - a way out of the app, only to origins the add-on declared (#964)', () => {
  const link = (href: string) => ({ type: 'link', label: 'Ansehen', href })
  const withLinks = { imageOrigins: ['https://www.youtube.com'] }

  it('accepts a link to a declared origin, also as the trailing part of a list row', () => {
    expect(validateUiTree(link('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), withLinks)).toMatchObject({ ok: true })
    expect(validateUiTree({ type: 'listRow', title: 'x', trailing: link('https://www.youtube.com/watch?v=x') }, withLinks)).toMatchObject({ ok: true })
  })

  it('refuses every other target: another host, http, javascript:, data:, intent:, credentials, not a URL', () => {
    for (const href of ['https://evil.example/', 'http://www.youtube.com/x', 'javascript:alert(1)', 'data:text/html,x', 'intent://scan/#Intent;scheme=zxing;end', 'https://www.youtube.com@evil.example/', 'not a url', '']) {
      expect(validateUiTree(link(href), withLinks), href).toMatchObject({ ok: false, code: 'ui.link-origin' })
    }
    expect(validateUiTree({ type: 'listRow', title: 'x', trailing: link('https://evil.example/') }, withLinks)).toMatchObject({ ok: false, code: 'ui.link-origin', path: 'trailing' })
  })
})
