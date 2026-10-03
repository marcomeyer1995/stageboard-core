import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { certFingerprint } from './certFingerprint.js'

describe('certFingerprint', () => {
  it('matches the openssl SHA-256 fingerprint, as lowercase hex without colons', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-'))
    const cert = join(dir, 'c.pem')
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:1024', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', cert, '-days', '1', '-subj', '/CN=test'], { stdio: 'ignore' })
    const expected = execFileSync('openssl', ['x509', '-in', cert, '-noout', '-fingerprint', '-sha256']).toString().split('=')[1]!.trim().replace(/:/g, '').toLowerCase()
    expect(certFingerprint(readFileSync(cert, 'utf8'))).toBe(expected)
    expect(expected).toMatch(/^[0-9a-f]{64}$/)
  })
})
