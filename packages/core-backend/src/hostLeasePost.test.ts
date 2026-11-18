import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { certFingerprint } from './certFingerprint.js'
import { getFromHost, postToHost } from './hostLeaseService.js'

// A real https server with a self-signed certificate: postToHost must pin to the listed fingerprint (#918).
let server: Server
let url: string
let fingerprint: string
const received: string[] = []
const hostHeaders: (string | undefined)[] = []

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lease-'))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' })
  const cert = readFileSync(join(dir, 'c.pem'), 'utf8')
  fingerprint = certFingerprint(cert)
  server = createServer({ key: readFileSync(join(dir, 'k.pem')), cert }, (req, res) => {
    hostHeaders.push(req.headers.host)
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      received.push(body)
      res.statusCode = 200
      res.end(req.method === 'GET' ? '{"serverTime":42}' : '{}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/host/lease`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

describe('postToHost (#918)', () => {
  it('delivers to a host whose certificate has the listed fingerprint', async () => {
    expect(await postToHost(url, { hello: 1 }, fingerprint)).toBe(true)
    expect(received.at(-1)).toBe('{"hello":1}')
  })

  it('names the real port in the Host header, not the default one', async () => {
    await postToHost(url, {}, fingerprint)
    expect(hostHeaders.at(-1)).toBe(new URL(url).host)
    expect(hostHeaders.at(-1)).toMatch(/:\d{4,5}$/)
  })

  it('refuses a host whose certificate has another fingerprint, and sends nothing', async () => {
    const before = received.length
    expect(await postToHost(url, { hello: 2 }, 'f'.repeat(64))).toBe(false)
    expect(received.length).toBe(before)
  })

  it('without a listed fingerprint it still delivers (the signature is the protection)', async () => {
    expect(await postToHost(url, { hello: 3 }, undefined)).toBe(true)
  })

  it('is false, not an error, for a host that is not there', async () => {
    expect(await postToHost('https://127.0.0.1:9/host/lease', {}, undefined, 500)).toBe(false)
  })
})

describe('getFromHost (#919)', () => {
  it('reads the JSON answer of a host with the listed fingerprint', async () => {
    expect(await getFromHost(url, fingerprint)).toEqual({ serverTime: 42 })
  })

  it('is null for another fingerprint, a host that is not there, or an answer that is not JSON', async () => {
    expect(await getFromHost(url, 'f'.repeat(64))).toBeNull()
    expect(await getFromHost('https://127.0.0.1:9/time', undefined, 500)).toBeNull()
  })
})
