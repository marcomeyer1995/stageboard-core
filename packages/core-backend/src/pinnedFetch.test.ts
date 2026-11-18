import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { certFingerprint } from './certFingerprint.js'
import { createPinnedFetch } from './pinnedFetch.js'

let server: Server
let base: string
let fingerprint: string
const seen: { method?: string; auth?: string; body: string }[] = []

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pin-'))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' })
  const cert = readFileSync(join(dir, 'c.pem'), 'utf8')
  fingerprint = certFingerprint(cert)
  server = createServer({ key: readFileSync(join(dir, 'k.pem')), cert }, (req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen.push({ method: req.method, auth: req.headers.authorization, body })
      if (req.url === '/slow') return void setTimeout(() => res.end('late'), 2_000)
      res.writeHead(req.url === '/missing' ? 404 : 200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, echo: body }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `https://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

describe('createPinnedFetch (#919)', () => {
  it('fetches from a host whose certificate has the listed fingerprint, with method, headers and body', async () => {
    const pinned = createPinnedFetch(fingerprint)
    const response = await pinned(`${base}/x`, { method: 'POST', headers: { Authorization: 'Basic abc' }, body: '{"a":1}' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, echo: '{"a":1}' })
    expect(seen.at(-1)).toMatchObject({ method: 'POST', auth: 'Basic abc', body: '{"a":1}' })
  })

  it('passes a non-2xx status through as a response, not an error', async () => {
    const response = await createPinnedFetch(fingerprint)(`${base}/missing`)
    expect(response.status).toBe(404)
  })

  it('refuses another fingerprint and sends nothing', async () => {
    const before = seen.length
    await expect(createPinnedFetch('f'.repeat(64))(`${base}/x`)).rejects.toThrow(/fingerprint/)
    expect(seen.length).toBe(before)
  })

  it('without a listed fingerprint it still connects (no pinning possible)', async () => {
    const response = await createPinnedFetch(undefined)(`${base}/x`)
    expect(response.status).toBe(200)
  })

  it('stops when the caller aborts', async () => {
    const controller = new AbortController()
    const pending = createPinnedFetch(fingerprint)(`${base}/slow`, { signal: controller.signal })
    setTimeout(() => controller.abort(), 100)
    await expect(pending).rejects.toThrow()
  })

  it('rejects, not hangs, for a host that is not there', async () => {
    await expect(createPinnedFetch(undefined)('https://127.0.0.1:9/x')).rejects.toThrow()
  })
})
