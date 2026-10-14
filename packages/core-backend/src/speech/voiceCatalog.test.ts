import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseModelCard, SpeechVoices } from './voiceCatalog.js'

const model = Buffer.from('fake onnx model')
const md5 = (b: Buffer | string) => createHash('md5').update(b).digest('hex')
const catalog: Record<string, unknown> = {
  'pt_PT-tugão-medium': { key: 'pt_PT-tugão-medium', name: 'tugão', language: { code: 'pt_PT', name_native: 'Português' }, quality: 'medium', files: {} },
  'bad/../key': { key: 'bad/../key', name: 'x', language: { code: 'xx', name_native: 'x' }, quality: 'low', files: {} },
  'de_DE-test-medium': {
    key: 'de_DE-test-medium',
    name: 'test',
    language: { code: 'de_DE', name_native: 'Deutsch', country_english: 'Germany' },
    quality: 'medium',
    files: {
      'de/de_DE/test/medium/de_DE-test-medium.onnx': { size_bytes: model.length, md5_digest: md5(model) },
      'de/de_DE/test/medium/de_DE-test-medium.onnx.json': { size_bytes: 2, md5_digest: md5('{}') },
      'de/de_DE/test/medium/MODEL_CARD': { size_bytes: 10, md5_digest: md5('* License: CC0\n') },
    },
  },
}
function fakeFetch(opts: { offline?: boolean; badModel?: boolean } = {}): typeof fetch {
  return (async (url: string) => {
    if (opts.offline) throw new Error('offline')
    const u = String(url)
    const body = u.endsWith('voices.json') ? JSON.stringify(catalog) : u.endsWith('.onnx') ? (opts.badModel ? 'broken' : model) : u.endsWith('.onnx.json') ? '{}' : u.endsWith('MODEL_CARD') ? '* License: CC0\n' : null
    return body === null ? new Response('no', { status: 404 }) : new Response(body)
  }) as unknown as typeof fetch
}
async function settle(voices: SpeechVoices) {
  for (let i = 0; i < 50; i++) {
    const { download } = await voices.list(true)
    if (download?.state !== 'running') return download
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('speech voice catalog (#63)', () => {
  it('lists Piper voices and the extra dialect voices, then downloads one with checksum', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voices-'))
    const voices = new SpeechVoices(dir, fakeFetch())
    const list = await voices.list(true)
    expect(list.catalog).toBe('online')
    expect(list.voices.map((v) => v.key)).toEqual(expect.arrayContaining(['de_DE-test-medium', 'de_DE-thorsten_hessisch-high', 'pt_PT-tugão-medium']))
    expect(list.voices.some((v) => v.key.includes('/'))).toBe(false)
    expect(list.voices.find((v) => v.key === 'de_DE-test-medium')).toMatchObject({ installed: false, languageName: 'Deutsch (Germany)', sizeBytes: model.length })
    expect(await voices.install('de_DE-test-medium')).toBe(true)
    expect((await settle(voices))?.state).toBe('done')
    expect(voices.voicePath('de_DE-test-medium')).toBe(join(dir, 'de_DE-test-medium.onnx'))
    expect(await voices.license('de_DE-test-medium')).toEqual({ key: 'de_DE-test-medium', license: 'CC0', finetunedFrom: null })
  })

  it('rejects a download whose checksum does not match, leaving nothing installed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voices-'))
    const voices = new SpeechVoices(dir, fakeFetch({ badModel: true }))
    await voices.install('de_DE-test-medium')
    expect(await settle(voices)).toMatchObject({ state: 'failed' })
    expect(existsSync(join(dir, 'de_DE-test-medium.onnx'))).toBe(false)
  })

  it('works offline from the saved list', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voices-'))
    await new SpeechVoices(dir, fakeFetch()).list(true)
    const offline = new SpeechVoices(dir, fakeFetch({ offline: true }))
    const list = await offline.list(true)
    expect(list.catalog).toBe('cached')
    expect(list.voices.some((v) => v.key === 'de_DE-test-medium')).toBe(true)
  })

  it('reads licence and base voice from a model card', () => {
    expect(parseModelCard('* License: CC0\n\n## Training\n\nFinetuned from U.S. English lessac voice (medium quality).')).toEqual({ license: 'CC0', finetunedFrom: 'U.S. English lessac voice (medium quality)' })
  })
})
