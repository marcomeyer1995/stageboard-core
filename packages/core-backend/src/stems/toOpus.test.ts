import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { oggOpusInfo, webmOpusToOgg } from 'shared-types'
import { convertToOpus, toOpusAvailable, toOpusConfigFromEnv } from './toOpus.js'

const fixtures = join(__dirname, '../../../shared-types/src/__fixtures__')

/** A stand-in for Python: `$1` = script, `$2` = input, `$3` = output. */
function fakePython(dir: string, body: string): string {
  const path = join(dir, 'python')
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

describe('convertToOpus', () => {
  it('returns what the script wrote once it reads as Ogg Opus', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'to-opus-'))
    writeFileSync(join(dir, 'good.opus'), webmOpusToOgg(new Uint8Array(readFileSync(join(fixtures, 'stereo.webm'))))!)
    const python = fakePython(dir, `cp "${join(dir, 'good.opus')}" "$3"`)
    const data = await convertToOpus(join(dir, 'in.m4a'), join(dir, 'out.opus'), { python, script: python })
    expect(oggOpusInfo(data)).toEqual({ channels: 2, preSkip: 312, frames: 72000 })
  })

  it('a failing script or a broken file is an error, never a track', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'to-opus-'))
    const failing = fakePython(dir, 'echo "av.error.InvalidDataError: no audio" >&2; exit 1')
    await expect(convertToOpus('in', join(dir, 'out.opus'), { python: failing, script: failing })).rejects.toThrow(/Code 1.*InvalidDataError/)
    const garbage = fakePython(dir, 'echo nope > "$3"')
    await expect(convertToOpus('in', join(dir, 'out.opus'), { python: garbage, script: garbage })).rejects.toThrow(/kein gültiges Ogg Opus/)
  })

  it('knows whether the venv is there', () => {
    expect(toOpusAvailable({ python: '/nonexistent/python', script: toOpusConfigFromEnv().script })).toBe(false)
    expect(existsSync(toOpusConfigFromEnv().script)).toBe(true)
  })
})
