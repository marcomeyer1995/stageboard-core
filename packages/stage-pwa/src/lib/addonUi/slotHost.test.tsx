import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EnvelopeSchema, UI_LIMITS, type AddonError } from 'shared-types'
import { AddonSlot, type ViewWorkerLike } from './slotHost'

/** A stand-in for the add-on's view script Worker: records what the host sends, lets a test play the add-on. */
function fakeWorker() {
  const sent: Record<string, unknown>[] = []
  const worker: ViewWorkerLike & { terminated: boolean; say: (message: unknown) => void } = {
    terminated: false,
    onmessage: null,
    onerror: null,
    postMessage: (m) => void sent.push(m as Record<string, unknown>),
    terminate: () => void (worker.terminated = true),
    say: (message) => act(() => worker.onmessage?.({ data: message })),
  }
  return { worker, sent }
}

const sources = { jobs: { abc: { progress: 0.1 } }, state: {} }
const addon = { id: 'youtube', code: '/* view */', imageOrigins: ['https://i.ytimg.com'] }
const tree = (text: string) => ({ type: 'stack', children: [{ type: 'text', role: 'body', text }, { type: 'button', variant: 'primary', label: 'Go', action: 'go' }] })
const setTree = (t: unknown) => ({ kind: 'ui-set', slot: 'song-editor.track-source', tree: t })

function mount(over: Partial<React.ComponentProps<typeof AddonSlot>> = {}) {
  const { worker, sent } = fakeWorker()
  const onHealth = vi.fn()
  const utils = render(<AddonSlot slot="song-editor.track-source" addon={addon} context={{ variantId: 'v1' }} language="de" sources={sources} onHealth={onHealth} createWorker={() => worker} {...over} />)
  return { worker, sent, onHealth, ...utils }
}

describe('AddonSlot - the view script in a Worker of its own, its UI drawn by the app (#964, docs/36 §6)', () => {
  it('starts the worker, says init, then asks it to open the slot with the context', () => {
    const { sent } = mount()
    expect(sent[0]).toMatchObject({ type: 'init', contractVersion: 3, language: 'de' })
    expect(sent[1]).toEqual({ kind: 'ui-action', slot: 'song-editor.track-source', action: 'open', value: { variantId: 'v1' } })
  })

  it('draws the tree the add-on sets, and a tap sends exactly one ui-action back', () => {
    const { worker, sent } = mount()
    worker.say(setTree(tree('Hello')))
    expect(screen.getByText('Hello')).toBeInTheDocument()
    const before = sent.length
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(sent.length).toBe(before + 1)
    expect(sent[sent.length - 1]).toEqual({ kind: 'ui-action', slot: 'song-editor.track-source', action: 'go' })
  })

  it('a new ui-set replaces the tree', () => {
    const { worker } = mount()
    worker.say(setTree(tree('First')))
    worker.say(setTree(tree('Second')))
    expect(screen.queryByText('First')).toBeNull()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  it('an invalid tree is refused with its code in the add-on health - and the previous tree stays on screen', () => {
    const { worker, onHealth } = mount()
    worker.say(setTree(tree('Good')))
    worker.say(setTree({ type: 'stack', children: [{ type: 'iframe', src: 'https://evil.example' }] }))
    expect(screen.getByText('Good')).toBeInTheDocument()
    expect(onHealth).toHaveBeenLastCalledWith({ status: 'error', code: 'ui.unknown-node', message: expect.stringContaining('children[0]') })
    worker.say(setTree({ type: 'image', src: 'https://evil.example/a.jpg', role: 'thumb' }))
    expect(onHealth).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'ui.image-origin' }))
    expect(screen.getByText('Good')).toBeInTheDocument()
  })

  it('more than 10 ui-sets within a second: the extra ones are dropped (ui.rate); a second later it works again', () => {
    let now = 1_000
    const { worker, onHealth } = mount({ now: () => now })
    for (let i = 0; i < UI_LIMITS.maxSetsPerSecond; i++) worker.say(setTree(tree(`n${i}`)))
    expect(screen.getByText('n9')).toBeInTheDocument()
    worker.say(setTree(tree('too many')))
    expect(screen.queryByText('too many')).toBeNull()
    expect(onHealth).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error', code: 'ui.rate' }))
    now += 1_001
    worker.say(setTree(tree('later')))
    expect(screen.getByText('later')).toBeInTheDocument()
  })

  it('a ui-set for another slot, and anything that is no envelope, is ignored', () => {
    const { worker } = mount()
    worker.say(setTree(tree('Mine')))
    worker.say({ kind: 'ui-set', slot: 'device.panel', tree: tree('Not mine') })
    worker.say({ type: 'job-result' })
    worker.say('garbage')
    worker.say(null)
    expect(screen.getByText('Mine')).toBeInTheDocument()
    expect(screen.queryByText('Not mine')).toBeNull()
  })

  it('a bound progress follows the job source; the changed job is told to the view script so its text can finish too', () => {
    const { worker, sent, rerender } = mount()
    worker.say(setTree({ type: 'progress', value: { bind: 'job:abc.progress' } }))
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10')
    const before = sent.length
    rerender(<AddonSlot slot="song-editor.track-source" addon={addon} context={{ variantId: 'v1' }} language="de" sources={{ ...sources, jobs: { abc: { progress: 0.7, status: 'done' } } }} createWorker={() => worker} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '70')
    // ONE update about the job, not per frame - the add-on does not get a message for every bound value.
    expect(sent.slice(before)).toEqual([{ kind: 'notify', topic: 'jobs', body: { abc: { progress: 0.7, status: 'done' } } }])
    // And it is a valid envelope of the contract (it was not: `update` without an id).
    expect(EnvelopeSchema.safeParse(sent[sent.length - 1]).success).toBe(true)
  })

  it('a request from the view script goes to the app and the answer comes back as a response; a failing app says so', async () => {
    const onRequest = vi.fn(async (method: string): Promise<{ ok: true; body: unknown } | { ok: false; error: AddonError }> => (method === 'search' ? { ok: true, body: { hits: [] } } : { ok: false, error: { code: 'method.undeclared', message: 'nope' } }))
    const { worker, sent } = mount({ onRequest })
    worker.say({ kind: 'request', id: 5, method: 'search', body: { query: 'x' } })
    worker.say({ kind: 'request', id: 6, method: 'other', body: {} })
    await act(async () => undefined)
    expect(sent).toContainEqual({ kind: 'response', id: 5, ok: true, body: { hits: [] } })
    expect(sent).toContainEqual({ kind: 'response', id: 6, ok: false, error: { code: 'method.undeclared', message: 'nope' } })
  })

  it('a view script that throws marks the add-on as failed and keeps the last tree; unmounting ends the worker', () => {
    const { worker, onHealth, unmount } = mount()
    worker.say(setTree(tree('Still here')))
    act(() => worker.onerror?.({ message: 'boom' }))
    expect(onHealth).toHaveBeenLastCalledWith({ status: 'error', code: 'addon.crashed', message: expect.stringContaining('boom') })
    expect(screen.getByText('Still here')).toBeInTheDocument()
    unmount()
    expect(worker.terminated).toBe(true)
  })
})

describe('AddonSlot inline (#964, one dialog not two)', () => {
  it('a dialog node from the add-on becomes its children when the caller is already a dialog - no nested dialog', () => {
    const { worker } = mount({ inline: true })
    worker.say({ kind: 'ui-set', slot: 'song-editor.track-source', tree: { type: 'dialog', size: 'M', title: 'Von YouTube laden', children: [{ type: 'text', role: 'title', text: 'Im ersten Dialog' }] } })
    expect(screen.getByText('Im ersten Dialog')).toBeInTheDocument()
    expect(screen.queryAllByRole('dialog')).toHaveLength(0)
  })
})
