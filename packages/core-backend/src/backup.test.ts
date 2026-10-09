import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BackupTarget, BackupTargetStatus } from 'shared-types'
import { createBackupService, dueReason, type BackupDeps, type ExecResult } from './backup.js'

const status = (extra: Partial<BackupTargetStatus> = {}): BackupTargetStatus => ({ lastSuccessAt: null, lastRunAt: null, lastError: null, lastBytes: null, running: false, present: null, ...extra })
const folder = (extra: Partial<BackupTarget> = {}): BackupTarget => ({ id: 'usb', name: 'USB-Stick', kind: 'folder', path: '/media/marco/STICK', keep: 7, dailyAt: null, onPlugIn: true, enabled: true, ...extra })
const nas = (extra: Partial<BackupTarget> = {}): BackupTarget => ({ id: 'nas', name: 'NAS', kind: 'ssh', host: 'nas.local', user: 'backup', remotePath: '/volume1/stageboard', keep: 2, dailyAt: '04:00', onPlugIn: false, enabled: true, ...extra })
const at = (iso: string) => new Date(iso)

describe('dueReason (#363)', () => {
  it('daily: after its time when nothing ran since - also catching up later the same day', () => {
    const t = folder({ dailyAt: '04:00', onPlugIn: false })
    expect(dueReason(t, status(), at('2026-10-09T03:59:00'), true, true)).toBeNull()
    expect(dueReason(t, status(), at('2026-10-09T04:00:30'), true, true)).toBe('daily')
    expect(dueReason(t, status({ lastRunAt: '2026-10-09T04:00:31' }), at('2026-10-09T09:00:00'), true, true)).toBeNull()
    expect(dueReason(t, status({ lastRunAt: '2026-10-08T04:00:31' }), at('2026-10-09T11:00:00'), true, true)).toBe('daily')
  })

  it('plug-in: the medium just appeared and the last success is over a day old', () => {
    const t = folder()
    expect(dueReason(t, status(), at('2026-10-09T12:00:00'), true, false)).toBe('plug-in')
    expect(dueReason(t, status({ lastSuccessAt: '2026-10-09T08:00:00' }), at('2026-10-09T12:00:00'), true, false)).toBeNull()
    // Still plugged in since last tick: no new reason.
    expect(dueReason(t, status(), at('2026-10-09T12:00:00'), true, true)).toBeNull()
  })

  it('nothing for a missing medium, a disabled target, or a target without a schedule', () => {
    expect(dueReason(folder({ dailyAt: '04:00' }), status(), at('2026-10-09T05:00:00'), false, false)).toBeNull()
    expect(dueReason(folder({ enabled: false }), status(), at('2026-10-09T05:00:00'), true, false)).toBeNull()
    expect(dueReason(folder({ onPlugIn: false }), status(), at('2026-10-09T05:00:00'), true, false)).toBeNull()
  })
})

describe('backup service', () => {
  let dir: string
  let calls: Array<{ cmd: string; args: string[]; env?: NodeJS.ProcessEnv }>
  let present: Set<string>
  let playing: boolean
  let remoteListing: string
  let scriptFails: string | null

  const deps = (): BackupDeps => ({
    stateDir: dir,
    dataDir: join(dir, 'data'),
    scriptPath: '/repo/scripts/backup.mjs',
    stagingRoot: join(dir, 'staging'),
    now: () => at('2026-10-09T04:01:00'),
    exists: (p) => present.has(p) || p.startsWith(dir),
    isPlaying: async () => playing,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    exec: async (cmd, args, env): Promise<ExecResult> => {
      calls.push({ cmd, args, env })
      if (cmd === process.execPath) {
        // The real script writes its status file; the fake does the same.
        const file = env!.STAGEBOARD_BACKUP_STATUS_FILE!
        if (scriptFails) {
          writeFileSync(file, JSON.stringify({ ok: false, error: scriptFails }))
          return { code: 1, stdout: '', stderr: scriptFails }
        }
        writeFileSync(file, JSON.stringify({ ok: true, generation: 'stageboard-2026-10-09_0401', totalBytes: 1000 }))
        return { code: 0, stdout: '', stderr: '' }
      }
      if (cmd === 'ssh' && args.at(-1)!.includes('ls -1')) return { code: 0, stdout: remoteListing, stderr: '' }
      if (cmd === 'du') return { code: 0, stdout: '5000\t/data', stderr: '' }
      if (cmd === 'stat') return { code: 0, stdout: args[2] === '/media/marco/SAMEDISK' ? '42\n42\n' : '43\n42\n', stderr: '' }
      if (cmd === 'ssh-keygen') {
        writeFileSync(`${args.at(-1)}.pub`, 'ssh-ed25519 AAAA stageboard-backup')
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 0, stdout: 'ok', stderr: '' }
    },
  })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sb-backup-'))
    calls = []
    present = new Set(['/media/marco/STICK'])
    playing = false
    remoteListing = ''
    scriptFails = null
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('a folder target runs scripts/backup.mjs into its folder and keeps the outcome', async () => {
    const service = createBackupService(deps())
    service.save(folder())
    const result = await service.run('usb', 'manual')
    const script = calls.find((c) => c.cmd === process.execPath)!
    expect(script.args).toEqual(['/repo/scripts/backup.mjs', '/media/marco/STICK'])
    expect(script.env!.STAGEBOARD_BACKUP_KEEP).toBe('7')
    expect(result).toMatchObject({ lastSuccessAt: at('2026-10-09T04:01:00').toISOString(), lastError: null, lastBytes: 1000 })
    // Saved for the next start.
    expect(JSON.parse(readFileSync(join(dir, 'backup-target-status.json'), 'utf8')).usb.lastBytes).toBe(1000)
    expect(service.summary()).toMatchObject({ ok: true })
  })

  it('a missing medium or a failing run is an error in the status - never thrown, never silent', async () => {
    const service = createBackupService(deps())
    service.save(folder())
    present.clear()
    expect(await service.run('usb', 'manual')).toMatchObject({ lastError: expect.stringContaining('nicht eingesteckt'), lastSuccessAt: null })
    present.add('/media/marco/STICK')
    scriptFails = 'Disk full'
    expect(await service.run('usb', 'manual')).toMatchObject({ lastError: 'Disk full' })
    expect(service.summary()).toMatchObject({ ok: false, error: 'Disk full', target: 'USB-Stick' })
  })

  it('a NAS over SSH: databases staged, data rsynced with hard links to the last generation, old ones pruned', async () => {
    const service = createBackupService(deps())
    service.save(nas())
    remoteListing = 'stageboard-2026-10-07_0400\nstageboard-2026-10-08_0400\nsomething-else\n'
    const result = await service.run('nas', 'manual')
    expect(result.lastError).toBeNull()
    expect(calls.find((c) => c.cmd === process.execPath)!.env).toMatchObject({ STAGEBOARD_BACKUP_SKIP_DATA: '1', STAGEBOARD_BACKUP_ALLOW_SAME_DISK: '1' })
    const rsyncs = calls.filter((c) => c.cmd === 'rsync')
    expect(rsyncs[1]!.args).toContain('--link-dest=../../stageboard-2026-10-08_0400/data/')
    expect(rsyncs[1]!.args.at(-1)).toBe('backup@nas.local:/volume1/stageboard/stageboard-2026-10-09_0401/data/')
    // keep 2: the oldest of three goes - nothing that isn't a StageBoard generation.
    const prune = calls.filter((c) => c.cmd === 'ssh').at(-1)!.args.at(-1)!
    expect(prune).toBe("rm -rf '/volume1/stageboard/stageboard-2026-10-07_0400'")
    expect(result.lastBytes).toBe(6000)
  })

  it('the scheduler waits while a song plays and runs right after', async () => {
    const service = createBackupService(deps())
    service.save(folder({ dailyAt: '04:00', onPlugIn: false }))
    playing = true
    await service.tick()
    expect(calls.some((c) => c.cmd === process.execPath)).toBe(false)
    playing = false
    await service.tick()
    expect(calls.some((c) => c.cmd === process.execPath)).toBe(true)
  })

  it('plugging the stick in starts a backup once', async () => {
    const service = createBackupService(deps())
    service.save(folder())
    present.clear()
    await service.tick() // not there
    present.add('/media/marco/STICK')
    await service.tick() // plugged in
    await service.tick() // still in - no second run
    expect(calls.filter((c) => c.cmd === process.execPath)).toHaveLength(1)
  })

  it('overview shows the server key once a NAS target exists, and targets survive a restart', async () => {
    const first = createBackupService(deps())
    first.save(nas())
    expect((await first.overview()).publicKey).toBe('ssh-ed25519 AAAA stageboard-backup')
    const again = createBackupService(deps())
    expect((await again.overview()).targets.map((t) => t.target.id)).toEqual(['nas'])
    again.remove('nas')
    expect((await createBackupService(deps()).overview()).targets).toEqual([])
  })

  it('test: the folder must be writable; the NAS must answer over SSH', async () => {
    const service = createBackupService(deps())
    service.save(folder())
    service.save(nas())
    expect(await service.test('usb')).toMatchObject({ ok: true })
    service.save(folder({ id: 'same', path: '/media/marco/SAMEDISK' }))
    present.add('/media/marco/SAMEDISK')
    expect(await service.test('same')).toMatchObject({ ok: false, message: expect.stringContaining('derselben Platte') })
    present.clear()
    expect(await service.test('usb')).toMatchObject({ ok: false })
    expect(await service.test('nas')).toMatchObject({ ok: true })
  })
})
