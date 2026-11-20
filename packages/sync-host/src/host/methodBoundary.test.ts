import { describe, expect, it } from 'vitest'
import { parseContributes, type Contributes, type Envelope } from 'shared-types'
import { callMethod, METHOD_TIMEOUT_MS, type MethodSandbox } from './methodBoundary.js'

/** A method as a manifest would declare it (docs/36 §3): one input schema, one answer schema, both JSON Schema. */
const contributes: Contributes = parseContributes({
  methods: {
    search: {
      in: {
        type: 'object',
        required: ['query'],
        properties: { query: { type: 'string', minLength: 1 } },
        additionalProperties: false,
      },
      out: {
        type: 'object',
        required: ['results'],
        properties: {
          results: {
            type: 'array',
            items: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } },
          },
        },
        additionalProperties: false,
      },
    },
    broken: {
      // An add-on may declare nonsense; the boundary must answer with a code instead of crashing the core.
      in: { type: 'nonsense' },
      out: { type: 'object' },
    },
  },
}).contributes

type SeenCall = { method: string; body: unknown; timeoutMs: number }

/** Stands in for the real sandbox: records what the boundary asked and answers with what a script would. */
function fakeSandbox(answer: (call: SeenCall) => Promise<Envelope>) {
  const calls: SeenCall[] = []
  const sandbox: MethodSandbox = {
    request: (method, body, timeoutMs) => {
      const call = { method, body, timeoutMs }
      calls.push(call)
      return answer(call)
    },
  }
  return { calls, sandbox }
}

const answerWith = (body: unknown): Envelope => ({ kind: 'response', id: 1, ok: true, body })

describe('method calls at the add-on boundary (#964)', () => {
  it('passes a well-formed call through and hands the checked answer back', async () => {
    const result = { results: [{ title: 'Wonderwall' }] }
    const { calls, sandbox } = fakeSandbox(async () => answerWith(result))

    await expect(callMethod(sandbox, contributes, 'search', { query: 'Oasis' })).resolves.toEqual({ ok: true, body: result })
    expect(calls).toEqual([{ method: 'search', body: { query: 'Oasis' }, timeoutMs: METHOD_TIMEOUT_MS }])
  })

  it('refuses a method the manifest did not declare, and never calls the add-on', async () => {
    const { calls, sandbox } = fakeSandbox(async () => answerWith({}))

    for (const method of ['nope', 'toString', '__proto__']) {
      const result = await callMethod(sandbox, contributes, method, {})
      expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'method.undeclared', params: { method } }) })
    }
    expect(calls).toHaveLength(0)
  })

  it('refuses input that violates the declared `in` schema, and never calls the add-on', async () => {
    const { calls, sandbox } = fakeSandbox(async () => answerWith({ results: [] }))

    const result = await callMethod(sandbox, contributes, 'search', { query: 42 })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.code).toBe('method.input')
    expect(result.error.params?.method).toBe('search')
    expect(result.error.params?.errors).toContain('query')
    expect(calls).toHaveLength(0)
  })

  it('refuses an answer that violates the declared `out` schema and names the method', async () => {
    const { sandbox } = fakeSandbox(async () => answerWith({ results: [{ title: 42 }] }))

    const result = await callMethod(sandbox, contributes, 'search', { query: 'Oasis' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.code).toBe('method.output')
    expect(result.error.params?.method).toBe('search')
    expect(result.error.params?.errors).toContain('title')
  })

  it("passes the add-on's own error through unchanged", async () => {
    const error = { code: 'youtube.not-found', message: 'Kein Treffer für diese Suche', params: { query: 'Oasis' } }
    const { sandbox } = fakeSandbox(async () => ({ kind: 'response', id: 1, ok: false, error }))

    const result = await callMethod(sandbox, contributes, 'search', { query: 'Oasis' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    // Not copied, not reworded, not remapped: the core adds no message of its own for an add-on's domain.
    expect(result.error).toBe(error)
  })

  it('answers a timeout or rejection from the sandbox with the timeout code', async () => {
    const { sandbox } = fakeSandbox(async () => {
      throw new Error('The add-on did not answer within 10000 ms')
    })

    const result = await callMethod(sandbox, contributes, 'search', { query: 'Oasis' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.code).toBe('timeout')
    expect(result.error.params?.method).toBe('search')
  })

  it('answers a declared schema that does not compile with a code instead of throwing', async () => {
    const { calls, sandbox } = fakeSandbox(async () => answerWith({}))

    const result = await callMethod(sandbox, contributes, 'broken', {})
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.code).toBe('method.schema')
    expect(result.error.params?.method).toBe('broken')
    expect(calls).toHaveLength(0)
  })

  it('treats an envelope that is not a response as a broken answer', async () => {
    const { sandbox } = fakeSandbox(async () => ({ kind: 'notify', topic: 'log', body: 'hello' }))

    const result = await callMethod(sandbox, contributes, 'search', { query: 'Oasis' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.code).toBe('method.output')
  })
})
