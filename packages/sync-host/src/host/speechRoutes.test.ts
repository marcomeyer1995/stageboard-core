import { describe, expect, it, vi } from 'vitest'
import { createSpeechRoutes, type SpeechPorts } from './speechRoutes.js'
import { matchHostRoute, type HostRouteRequest } from './routes.js'

const WAV = new Uint8Array([82, 73, 70, 70, 1, 2, 3])

function ports(over: Partial<SpeechPorts> = {}): SpeechPorts & { speak: ReturnType<typeof vi.fn> } {
  return {
    pluginInstalled: () => true,
    normalise: (text) => text.trim().replace(/\s+/g, ' '),
    speak: vi.fn(async () => ({ ok: true as const, wav: WAV, generated: true })),
    voices: { list: async () => ({ voices: [] }), license: async (key: string) => ({ key, text: 'CC0' }), install: vi.fn(async () => true) },
    log: { info: vi.fn(), error: vi.fn() },
    ...over,
  } as SpeechPorts & { speak: ReturnType<typeof vi.fn> }
}

async function call(p: SpeechPorts, method: 'GET' | 'POST', path: string, query: Record<string, string> = {}) {
  const hit = matchHostRoute(createSpeechRoutes(p), method, path)
  if (!hit) throw new Error(`no route ${method} ${path}`)
  const request: HostRouteRequest = { method, path, params: hit.params, query }
  return hit.route.handle(request)
}

describe('the speech routes, with no engine (#964)', () => {
  it('answers a clip as audio/wav, cached for good, and logs when it was just generated', async () => {
    const p = ports()
    const answer = await call(p, 'GET', '/speech', { text: '  Hello   world ', voice: 'de_DE-thorsten-medium', speed: '1.2' })
    expect(answer).toMatchObject({ status: 200, binary: { contentType: 'audio/wav' }, headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } })
    expect(p.speak).toHaveBeenCalledWith('Hello world', 'de_DE-thorsten-medium', 1.2)
    expect(p.log?.info).toHaveBeenCalled()
  })

  it('does not log a clip that came from the cache', async () => {
    const p = ports({ speak: vi.fn(async () => ({ ok: true as const, wav: WAV, generated: false })) } as never)
    await call(p, 'GET', '/speech', { text: 'Hi' })
    expect(p.log?.info).not.toHaveBeenCalled()
  })

  it('refuses a missing text, a bad voice and a bad speed with 400 and their message codes - before asking the engine', async () => {
    const p = ports()
    expect((await call(p, 'GET', '/speech', { text: '   ' })).body).toMatchObject({ status: 'error', messageCode: 'speech.textMissing' })
    expect((await call(p, 'GET', '/speech', { text: 'x', voice: '../etc/passwd' })).body).toMatchObject({ messageCode: 'speech.invalidVoice' })
    expect((await call(p, 'GET', '/speech', { text: 'x', speed: 'fast' })).body).toMatchObject({ messageCode: 'speech.invalidSpeed' })
    for (const query of [{ text: '' }, { text: 'x', voice: '../x' }, { text: 'x', speed: '99' }]) expect((await call(p, 'GET', '/speech', query)).status).toBe(400)
    expect(p.speak).not.toHaveBeenCalled()
  })

  it('is 404 while the band has not installed the plugin - after the input is checked, so a stranger learns nothing from a 404 either way', async () => {
    const p = ports({ pluginInstalled: () => false })
    const answer = await call(p, 'GET', '/speech', { text: 'x' })
    expect(answer.status).toBe(404)
    expect(answer.body).toMatchObject({ messageCode: 'speech.pluginMissing' })
    expect((await call(p, 'GET', '/speech', { text: '' })).status).toBe(400)
    expect(p.speak).not.toHaveBeenCalled()
  })

  it('an engine that is not there is 503, one that failed is 500 - both with its message, and both logged', async () => {
    const down = ports({ speak: vi.fn(async () => ({ ok: false as const, reason: 'unavailable' as const, message: 'Piper is not installed', messageCode: 'speech.notInstalled' as const })) } as never)
    expect(await call(down, 'GET', '/speech', { text: 'x' })).toMatchObject({ status: 503, body: { status: 'error', message: 'Piper is not installed', messageCode: 'speech.notInstalled' } })
    const broken = ports({ speak: vi.fn(async () => ({ ok: false as const, reason: 'failed' as const, message: 'exit 1' })) } as never)
    expect((await call(broken, 'GET', '/speech', { text: 'x' })).status).toBe(500)
    expect(broken.log?.error).toHaveBeenCalledWith(expect.objectContaining({ reason: 'failed' }), 'Speech clip failed')
  })

  it('lists the voices, and says 404 without the plugin', async () => {
    expect(await call(ports(), 'GET', '/speech/voices')).toEqual({ status: 200, body: { voices: [] } })
    expect((await call(ports({ pluginInstalled: () => false }), 'GET', '/speech/voices')).status).toBe(404)
  })

  it('gives a voice\'s licence, 400 for a bad key, 404 without the plugin', async () => {
    expect(await call(ports(), 'GET', '/speech/voices/de_DE-thorsten-medium/license')).toEqual({ status: 200, body: { key: 'de_DE-thorsten-medium', text: 'CC0' } })
    expect((await call(ports(), 'GET', '/speech/voices/..%2Fx/license')).status).toBe(400)
    expect((await call(ports({ pluginInstalled: () => false }), 'GET', '/speech/voices/de_DE-thorsten-medium/license')).status).toBe(404)
  })

  it('starts a voice download, or says 409 when one is already running, 400 for a bad key, 404 without the plugin', async () => {
    const p = ports()
    expect(await call(p, 'POST', '/speech/voices/de_DE-thorsten-medium/install')).toEqual({ status: 200, body: { status: 'ok' } })
    expect(p.voices.install).toHaveBeenCalledWith('de_DE-thorsten-medium')
    expect((await call(ports({ voices: { list: async () => ({}), license: async () => ({}), install: async () => false } }), 'POST', '/speech/voices/de_DE-thorsten-medium/install'))).toMatchObject({ status: 409, body: { messageCode: 'speech.downloadBusy' } })
    expect((await call(p, 'POST', '/speech/voices/%00/install')).status).toBe(400)
    expect((await call(ports({ pluginInstalled: () => false }), 'POST', '/speech/voices/de_DE-thorsten-medium/install')).status).toBe(404)
  })
})
