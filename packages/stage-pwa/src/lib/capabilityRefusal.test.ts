import { describe, expect, it } from 'vitest'
import { capabilityRefusal } from './capabilityRefusal'

const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('capabilityRefusal (#962)', () => {
  it('names the capability and what is missing for a 501 capability_missing', async () => {
    const text = await capabilityRefusal(answer(501, { error: 'capability_missing', capability: 'hardware', needs: 'a desktop machine' }))
    expect(text).toContain('hardware')
    expect(text).toContain('a desktop machine')
  })

  it('is null for every other answer, so the caller keeps its own message', async () => {
    expect(await capabilityRefusal(answer(403, { error: 'capability_missing' }))).toBeNull()
    expect(await capabilityRefusal(answer(501, { error: 'other' }))).toBeNull()
    expect(await capabilityRefusal(new Response('not json', { status: 501 }))).toBeNull()
  })
})
