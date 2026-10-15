import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseStemProgress, parseStemResult, runStemSeparation } from './stemSeparation.js'

/** A stand-in for the Python/Demucs script: reports progress, writes one stem, prints RESULT. */
function fakePython(dir: string, body: string): string {
  const path = join(dir, 'python')
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

describe('stem separation (#9)', () => {
  it('reads progress and the result line, and only plain webm names', () => {
    expect(parseStemProgress('PROGRESS 0.472')).toBe(0.472)
    expect(parseStemProgress('Downloading model')).toBeNull()
    expect(parseStemResult('RESULT {"stems":[{"key":"drums","file":"drums.webm"},{"key":"x","file":"../evil.webm"}]}', '/out')).toEqual([{ key: 'drums', path: '/out/drums.webm' }])
  })

  it('runs the script with the chosen options and returns the stems', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stems-'))
    // $1 = script, $2 = input, $3 = outdir, $4 = model, $5 = --split-guitar
    const python = fakePython(dir, 'echo "PROGRESS 0.5"; echo "$4 $5" > "$3/args"; echo x > "$3/drums.webm"; echo \'RESULT {"stems":[{"key":"drums","file":"drums.webm"}]}\'')
    const seen: number[] = []
    const stems = await runStemSeparation(join(dir, 'in'), dir, { model: 'extended', splitGuitar: true }, (p) => seen.push(p), { python, script: python })
    expect(stems).toEqual([{ key: 'drums', path: join(dir, 'drums.webm') }])
    expect(seen).toEqual([0.5])
  })

  it('fails with a clear message when Demucs is not installed or the script fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stems-'))
    await expect(runStemSeparation('in', dir, { model: 'standard', splitGuitar: false }, () => {}, { python: join(dir, 'missing'), script: join(dir, 'missing') })).rejects.toThrow(/nicht installiert/)
    const python = fakePython(dir, 'echo "boom" >&2; exit 3')
    await expect(runStemSeparation('in', dir, { model: 'standard', splitGuitar: false }, () => {}, { python, script: python })).rejects.toThrow(/Code 3.*boom/)
  })
})
