import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildYtDlpArgs, mimeTypeForExt, parseYtDlpProgress, resolveYtDlpExecutable, runYtDlpExtract, ytDlpErrorSummary } from './ytDlp.js'

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}))

describe('resolveYtDlpExecutable', () => {
  const originalPath = process.env.YT_DLP_PATH
  afterEach(() => {
    if (originalPath === undefined) delete process.env.YT_DLP_PATH
    else process.env.YT_DLP_PATH = originalPath
  })

  it('prefers the explicit env override over any candidate path', () => {
    process.env.YT_DLP_PATH = '/opt/custom/yt-dlp'
    expect(resolveYtDlpExecutable()).toBe('/opt/custom/yt-dlp')
  })

  it('throws an actionable error when nothing is configured or found', () => {
    delete process.env.YT_DLP_PATH
    expect(() => resolveYtDlpExecutable()).toThrow(/YT_DLP_PATH/)
  })
})

describe('parseYtDlpProgress', () => {
  it('reads the percentage out of a real download progress line', () => {
    expect(parseYtDlpProgress('[download]  42.3% of  3.45MiB at  1.23MiB/s ETA 00:02')).toBeCloseTo(0.423)
    expect(parseYtDlpProgress('[download] 100% of 3.45MiB')).toBeCloseTo(1)
    expect(parseYtDlpProgress('[download]   0.0% of ~ 5.12MiB at Unknown B/s ETA Unknown')).toBe(0)
  })

  it('returns null for anything that is not a download progress line', () => {
    expect(parseYtDlpProgress('[youtube] dQw4w9WgXcQ: Downloading webpage')).toBeNull()
    expect(parseYtDlpProgress('[Merger] Merging formats into "out.m4a"')).toBeNull()
    expect(parseYtDlpProgress('')).toBeNull()
  })
})

describe('mimeTypeForExt', () => {
  it('maps the extensions yt-dlp actually produces', () => {
    expect(mimeTypeForExt('m4a')).toBe('audio/mp4')
    expect(mimeTypeForExt('webm')).toBe('audio/webm')
    expect(mimeTypeForExt('MP3')).toBe('audio/mpeg') // case-insensitive
  })

  it('falls back to a generic type for an unlisted extension rather than failing', () => {
    expect(mimeTypeForExt('xyz')).toBe('application/octet-stream')
  })
})

describe('buildYtDlpArgs', () => {
  it('asks for audio-only, no playlist expansion, and puts the url after --', () => {
    const args = buildYtDlpArgs('https://youtu.be/abc', '/tmp/job-1/track.%(ext)s', 1234)
    expect(args).toContain('--no-playlist')
    expect(args).toEqual(expect.arrayContaining(['--max-filesize', '1234']))
    expect(args).toEqual(expect.arrayContaining(['--js-runtimes', `node:${process.execPath}`]))
    expect(args).toEqual(expect.arrayContaining(['-o', '/tmp/job-1/track.%(ext)s']))
    expect(args.at(-2)).toBe('--') // the url is isolated from being parsed as a flag
    expect(args.at(-1)).toBe('https://youtu.be/abc')
  })
})

describe('ytDlpErrorSummary', () => {
  it('keeps only the ERROR lines when yt-dlp printed warnings first', () => {
    const output = 'WARNING: [youtube] No supported JavaScript runtime could be found.\nERROR: [youtube] xxxxxxxxxxx: This video is unavailable\n'
    expect(ytDlpErrorSummary(output)).toBe('ERROR: [youtube] xxxxxxxxxxx: This video is unavailable')
  })

  it('falls back to the raw output when there is no ERROR line', () => {
    expect(ytDlpErrorSummary('  Killed\n')).toBe('Killed')
    expect(ytDlpErrorSummary('')).toBe('(no output)')
  })
})

describe('runYtDlpExtract', () => {
  let fakeChild: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    process.env.YT_DLP_PATH = '/usr/bin/yt-dlp'
    fakeChild = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() })
    vi.mocked(spawn).mockReturnValue(fakeChild as never)
  })
  afterEach(() => {
    delete process.env.YT_DLP_PATH
    vi.mocked(spawn).mockReset()
  })

  function run(timeoutMs?: number) {
    const progress: number[] = []
    const promise = runYtDlpExtract('https://youtu.be/abc', '/tmp/job-1/track.%(ext)s', (p) => progress.push(p), timeoutMs)
    return { promise, progress }
  }

  it('resolves with the destination path yt-dlp reports, and reports progress along the way', async () => {
    const { promise, progress } = run()
    fakeChild.stdout.emit('data', Buffer.from('[download]  10.0% of 3MiB\n'))
    fakeChild.stdout.emit('data', Buffer.from('[download] Destination: /tmp/job-1/track.m4a\n[download]  55.0% of 3MiB\n'))
    fakeChild.emit('close', 0)

    await expect(promise).resolves.toEqual({ filePath: '/tmp/job-1/track.m4a' })
    expect(progress).toEqual([0.1, 0.55])
  })

  it('rejects with the tail of stderr on a non-zero exit', async () => {
    const { promise } = run()
    fakeChild.stdout.emit('data', Buffer.from('[download] Destination: /tmp/job-1/track.m4a\n'))
    fakeChild.stderr.emit('data', Buffer.from('ERROR: Video unavailable\n'))
    fakeChild.emit('close', 1)

    await expect(promise).rejects.toThrow(/Video unavailable/)
  })

  it('rejects if yt-dlp exits cleanly but never announced a destination', async () => {
    const { promise } = run()
    fakeChild.emit('close', 0)
    await expect(promise).rejects.toThrow(/never reported a destination/)
  })

  it('rejects when the executable itself cannot be spawned', async () => {
    const { promise } = run()
    fakeChild.emit('error', new Error('ENOENT'))
    await expect(promise).rejects.toThrow('ENOENT')
  })

  it('reassembles a line split across two stdout chunks', async () => {
    const { promise } = run()
    fakeChild.stdout.emit('data', Buffer.from('[download] Destin'))
    fakeChild.stdout.emit('data', Buffer.from('ation: /tmp/job-1/track.webm\n'))
    fakeChild.emit('close', 0)
    await expect(promise).resolves.toEqual({ filePath: '/tmp/job-1/track.webm' })
  })

  it('still reads a final line that has no trailing newline', async () => {
    const { promise } = run()
    fakeChild.stdout.emit('data', Buffer.from('[download] Destination: /tmp/job-1/track.m4a'))
    fakeChild.emit('close', 0)
    await expect(promise).resolves.toEqual({ filePath: '/tmp/job-1/track.m4a' })
  })

  it('rejects with a clear message when yt-dlp skips a file over the size limit', async () => {
    const { promise } = run()
    fakeChild.stdout.emit('data', Buffer.from('[download] File is larger than max-filesize (300000000 bytes > 209715200 bytes). Aborting.\n'))
    fakeChild.emit('close', 0)
    await expect(promise).rejects.toThrow(/größer als das Limit/)
  })

  it('kills a stalled yt-dlp after the timeout and rejects', async () => {
    vi.useFakeTimers()
    try {
      const { promise } = run(1_000)
      fakeChild.kill.mockImplementation(() => fakeChild.emit('close', null))
      vi.advanceTimersByTime(1_000)
      expect(fakeChild.kill).toHaveBeenCalledWith('SIGKILL')
      await expect(promise).rejects.toThrow(/abgebrochen/)
    } finally {
      vi.useRealTimers()
    }
  })
})
