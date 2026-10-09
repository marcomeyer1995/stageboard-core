import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BackupTargetSchema, type BackupOverview, type BackupTarget, type BackupTargetStatus } from 'shared-types'

/**
 * The Stage-Server's own backups (#363, Marco 2026-10-08): targets chosen in the app (System →
 * Backup) instead of a hand-edited systemd timer. Each target is a folder (USB stick, second disk,
 * ZFS dataset, OS-mounted NAS share) or a NAS over SSH/rsync. Runs daily at the target's time and
 * when its USB medium is plugged in (last success over a day ago), never while a song plays, one
 * backup at a time. The writing itself is scripts/backup.mjs (CouchDB with revisions, data, certs,
 * generations); restoring is scripts/backup-restore.mjs (docs/03 "Backup & Wiederherstellung").
 */

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export interface BackupDeps {
  stateDir: string
  dataDir: string
  scriptPath: string
  stagingRoot: string
  now: () => Date
  exists: (path: string) => boolean
  exec: (cmd: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<ExecResult>
  /** A song plays in the band this server serves - no backup then (CPU and disk belong to the show). */
  isPlaying: () => Promise<boolean>
  log: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void }
}

const EMPTY_STATUS: BackupTargetStatus = { lastSuccessAt: null, lastRunAt: null, lastError: null, lastBytes: null, running: false, present: null }
const DAY_MS = 24 * 60 * 60 * 1000
const GENERATION = /^stageboard-\d{4}-\d{2}-\d{2}_\d{4}$/

/**
 * Why `target` should be backed up now, or null. Pure, so the rules are testable:
 * - `daily`: its time today has passed and nothing ran on it since then (a server that was off at
 *   4:00 catches up when it is back the same day);
 * - `plug-in`: a folder target whose medium just appeared, last success over a day ago.
 */
export function dueReason(
  target: BackupTarget,
  status: BackupTargetStatus,
  now: Date,
  present: boolean | null,
  wasPresent: boolean | null,
): 'daily' | 'plug-in' | null {
  if (!target.enabled) return null
  if (target.kind === 'folder' && present === false) return null
  const lastRun = status.lastRunAt ? new Date(status.lastRunAt).getTime() : 0
  if (target.dailyAt) {
    const [h, m] = target.dailyAt.split(':').map(Number) as [number, number]
    const scheduled = new Date(now)
    scheduled.setHours(h, m, 0, 0)
    if (now.getTime() >= scheduled.getTime() && lastRun < scheduled.getTime()) return 'daily'
  }
  if (target.kind === 'folder' && target.onPlugIn && present === true && wasPresent !== true) {
    const lastSuccess = status.lastSuccessAt ? new Date(status.lastSuccessAt).getTime() : 0
    if (now.getTime() - lastSuccess > DAY_MS) return 'plug-in'
  }
  return null
}

/** For a remote shell command: a path in single quotes. */
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

export function createBackupService(deps: BackupDeps) {
  const configFile = join(deps.stateDir, 'backup-targets.json')
  const statusFile = join(deps.stateDir, 'backup-target-status.json')
  const sshDir = join(deps.stateDir, 'backup-ssh')
  const keyFile = join(sshDir, 'id_ed25519')

  const readJson = <T>(file: string, fallback: T): T => {
    try {
      return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback
    } catch (err) {
      deps.log.error({ err, file }, 'Backup file unreadable')
      return fallback
    }
  }
  const writeJson = (file: string, value: unknown) => {
    mkdirSync(deps.stateDir, { recursive: true })
    writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 })
  }

  let targets: BackupTarget[] = readJson<{ targets: unknown[] }>(configFile, { targets: [] })
    .targets.map((t) => BackupTargetSchema.safeParse(t))
    .filter((r) => r.success)
    .map((r) => r.data)
  const statuses: Record<string, BackupTargetStatus> = readJson(statusFile, {})
  const presentBefore = new Map<string, boolean | null>()
  const pending = new Map<string, 'daily' | 'plug-in' | 'manual'>()
  let running: string | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  const statusOf = (id: string): BackupTargetStatus => ({ ...EMPTY_STATUS, ...statuses[id], running: running === id })
  const setStatus = (id: string, patch: Partial<BackupTargetStatus>) => {
    statuses[id] = { ...statusOf(id), ...patch, running: false }
    writeJson(statusFile, statuses)
  }
  const presentOf = (t: BackupTarget) => (t.kind === 'folder' ? deps.exists(t.path!) : null)

  const sshArgs = (t: BackupTarget) => [
    '-i', keyFile,
    '-p', String(t.port ?? 22),
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=15',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${join(sshDir, 'known_hosts')}`,
  ]
  const remote = (t: BackupTarget) => `${t.user}@${t.host}`

  async function ensureKey(): Promise<string | null> {
    if (!existsSync(keyFile)) {
      mkdirSync(sshDir, { recursive: true, mode: 0o700 })
      const r = await deps.exec('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'stageboard-backup', '-f', keyFile])
      if (r.code !== 0) {
        deps.log.error({ stderr: r.stderr }, 'Could not create the backup SSH key')
        return null
      }
    }
    try {
      return readFileSync(`${keyFile}.pub`, 'utf8').trim()
    } catch {
      return null
    }
  }

  /** Runs scripts/backup.mjs into `folder`; the script's own status (bytes, generation) or why it failed. */
  async function runScript(folder: string, keep: number, extraEnv: NodeJS.ProcessEnv = {}) {
    const tmpStatus = join(deps.stateDir, `backup-run-${Date.now()}.json`)
    const r = await deps.exec(process.execPath, [deps.scriptPath, folder], {
      ...process.env,
      STAGEBOARD_BACKUP_KEEP: String(keep),
      STAGEBOARD_BACKUP_STATUS_FILE: tmpStatus,
      STAGEBOARD_DATA_DIR: deps.dataDir,
      ...extraEnv,
    })
    const status = readJson<{ ok?: boolean; error?: string; generation?: string; totalBytes?: number } | null>(tmpStatus, null)
    rmSync(tmpStatus, { force: true })
    if (r.code !== 0 || !status?.ok) throw new Error(status?.error ?? (r.stderr.trim().split('\n').pop() || `backup.mjs exit ${r.code}`))
    return { generation: status.generation!, bytes: status.totalBytes ?? 0 }
  }

  async function runSsh(t: BackupTarget) {
    const staging = join(deps.stagingRoot, t.id)
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true, mode: 0o700 })
    try {
      // Databases, certificates and manifest locally; the data folder goes straight over rsync below.
      const { generation, bytes } = await runScript(staging, 1, { STAGEBOARD_BACKUP_SKIP_DATA: '1', STAGEBOARD_BACKUP_ALLOW_SAME_DISK: '1' })
      const ssh = ['ssh', ...sshArgs(t)].map(q).join(' ')
      const rp = t.remotePath!.replace(/\/+$/, '')
      const list = await deps.exec('ssh', [...sshArgs(t), remote(t), `mkdir -p ${q(rp)} && ls -1 ${q(rp)}`])
      if (list.code !== 0) throw new Error(`NAS nicht erreichbar: ${list.stderr.trim().split('\n').pop() ?? list.code}`)
      const previous = list.stdout.split('\n').filter((n) => GENERATION.test(n.trim())).map((n) => n.trim()).sort()
      const prev = previous[previous.length - 1]
      const meta = await deps.exec('rsync', ['-a', '-e', ssh, `${join(staging, generation)}/`, `${remote(t)}:${rp}/${generation}/`])
      if (meta.code !== 0) throw new Error(`Übertragung fehlgeschlagen: ${meta.stderr.trim().split('\n').pop()}`)
      // Unchanged backing tracks become hard links to the previous generation - no second copy.
      const data = await deps.exec('rsync', ['-a', '--delete', ...(prev ? [`--link-dest=../../${prev}/data/`] : []), '-e', ssh, `${deps.dataDir}/`, `${remote(t)}:${rp}/${generation}/data/`])
      if (data.code !== 0) throw new Error(`Übertragung der Daten fehlgeschlagen: ${data.stderr.trim().split('\n').pop()}`)
      const all = [...previous, generation].sort()
      const old = all.slice(0, Math.max(0, all.length - t.keep))
      if (old.length > 0) await deps.exec('ssh', [...sshArgs(t), remote(t), `rm -rf ${old.map((g) => q(`${rp}/${g}`)).join(' ')}`])
      const du = await deps.exec('du', ['-sb', deps.dataDir])
      return { generation, bytes: bytes + (Number(du.stdout.split(/\s/)[0]) || 0) }
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  }

  /** Backs up one target now. Never throws - the outcome is in its status (and the log). */
  async function run(id: string, reason: string): Promise<BackupTargetStatus> {
    const t = targets.find((x) => x.id === id)
    if (!t) throw new Error('Unknown backup target')
    if (running) {
      pending.set(id, 'manual')
      return statusOf(id)
    }
    running = id
    const startedAt = deps.now().toISOString()
    deps.log.info({ target: t.id, kind: t.kind, reason }, 'Backup started')
    try {
      if (t.kind === 'folder' && !deps.exists(t.path!)) throw new Error(`Ziel nicht da (nicht eingesteckt oder nicht eingehängt): ${t.path}`)
      const result = t.kind === 'folder' ? await runScript(t.path!, t.keep) : (await ensureKey(), await runSsh(t))
      running = null
      setStatus(id, { lastRunAt: startedAt, lastSuccessAt: startedAt, lastError: null, lastBytes: result.bytes })
      deps.log.info({ target: t.id, generation: result.generation, bytes: result.bytes }, 'Backup finished')
    } catch (err) {
      running = null
      const message = err instanceof Error ? err.message : String(err)
      setStatus(id, { lastRunAt: startedAt, lastError: message })
      deps.log.error({ target: t.id, err: message }, 'Backup failed')
    }
    return statusOf(id)
  }

  async function tick() {
    for (const t of targets) {
      const present = presentOf(t)
      const reason = dueReason(t, statusOf(t.id), deps.now(), present, presentBefore.get(t.id) ?? null)
      presentBefore.set(t.id, present)
      if (reason && !pending.has(t.id)) pending.set(t.id, reason)
    }
    if (running || pending.size === 0) return
    if (await deps.isPlaying()) return // tried again on the next tick
    const [id, reason] = pending.entries().next().value as [string, string]
    pending.delete(id)
    if (targets.some((t) => t.id === id)) await run(id, reason)
  }

  return {
    async overview(): Promise<BackupOverview> {
      const publicKey = targets.some((t) => t.kind === 'ssh') || existsSync(keyFile) ? await ensureKey() : null
      return { targets: targets.map((target) => ({ target, status: { ...statusOf(target.id), present: presentOf(target) } })), publicKey }
    },
    publicKey: ensureKey,
    save(target: BackupTarget) {
      targets = [...targets.filter((t) => t.id !== target.id), target]
      writeJson(configFile, { targets })
      deps.log.info({ target: target.id, kind: target.kind }, 'Backup target saved')
    },
    remove(id: string) {
      targets = targets.filter((t) => t.id !== id)
      delete statuses[id]
      pending.delete(id)
      writeJson(configFile, { targets })
      writeJson(statusFile, statuses)
      deps.log.info({ target: id }, 'Backup target removed')
    },
    run,
    /** "Verbindung testen": can the server write to the target? */
    async test(id: string): Promise<{ ok: boolean; message: string }> {
      const t = targets.find((x) => x.id === id)
      if (!t) return { ok: false, message: 'Unbekanntes Ziel' }
      if (t.kind === 'folder') {
        if (!deps.exists(t.path!)) return { ok: false, message: `Ordner nicht da (nicht eingesteckt oder nicht eingehängt): ${t.path}` }
        const w = await deps.exec('test', ['-w', t.path!])
        if (w.code !== 0) return { ok: false, message: 'Der Stage-Server darf in diesen Ordner nicht schreiben.' }
        // Same check as scripts/backup.mjs: not on the data's own disk (an unmounted mount point).
        const dev = await deps.exec('stat', ['-c', '%d', t.path!, deps.dataDir])
        const [a, b] = dev.stdout.trim().split('\n')
        if (dev.code === 0 && a && a === b) return { ok: false, message: 'Der Ordner liegt auf derselben Platte wie die Daten - Medium nicht eingehängt? Ein zweites Medium wählen.' }
        return { ok: true, message: 'Ordner ist beschreibbar und liegt auf einem eigenen Medium.' }
      }
      if (!(await ensureKey())) return { ok: false, message: 'SSH-Schlüssel des Servers fehlt.' }
      const rp = t.remotePath!.replace(/\/+$/, '')
      const r = await deps.exec('ssh', [...sshArgs(t), remote(t), `mkdir -p ${q(rp)} && test -w ${q(rp)} && echo ok`])
      if (r.code === 0 && r.stdout.includes('ok')) return { ok: true, message: `Verbunden - ${rp} ist beschreibbar.` }
      return { ok: false, message: r.stderr.trim().split('\n').pop() || 'Keine Verbindung zur NAS.' }
    },
    tick,
    /** Summary for the status line (Geräte → Stage-Server): null = nothing configured. */
    summary(): { ok: boolean; at?: string; error?: string; target?: string } | null {
      const enabled = targets.filter((t) => t.enabled)
      if (enabled.length === 0) return null
      const failing = enabled.find((t) => statusOf(t.id).lastError)
      if (failing) return { ok: false, at: statusOf(failing.id).lastRunAt ?? undefined, error: statusOf(failing.id).lastError!, target: failing.name }
      const last = enabled.map((t) => statusOf(t.id).lastSuccessAt).filter(Boolean).sort().pop()
      return last ? { ok: true, at: last } : { ok: false, error: 'Noch keine Sicherung gelaufen' }
    },
    start(intervalMs = 30_000) {
      timer ??= setInterval(() => void tick().catch((err) => deps.log.error({ err }, 'Backup tick failed')), intervalMs)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}

export type BackupService = ReturnType<typeof createBackupService>

/** The real dependencies (index.ts). */
export function realBackupDeps(isPlaying: () => Promise<boolean>, log: BackupDeps['log']): BackupDeps {
  // Like the rest of the backend: state in STAGEBOARD_STATE_DIR (production: ~/stageboard-data).
  const stateDir = process.env.STAGEBOARD_STATE_DIR ?? './data'
  const dataDir = process.env.STAGEBOARD_DATA_DIR ?? process.env.STAGEBOARD_STATE_DIR ?? join(homedir(), 'stageboard-data')
  return {
    stateDir,
    dataDir,
    scriptPath: fileURLToPath(new URL('../../../scripts/backup.mjs', import.meta.url)),
    stagingRoot: join(homedir(), '.cache', 'stageboard-backup-staging'),
    now: () => new Date(),
    exists: (path) => existsSync(path),
    exec: (cmd, args, env) =>
      new Promise((resolve) => {
        execFile(cmd, args, { env, maxBuffer: 64 * 1024 * 1024, timeout: 6 * 60 * 60 * 1000 }, (err, stdout, stderr) => {
          const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? ((err as unknown as { code: number }).code) : 1) : 0
          resolve({ code, stdout: String(stdout), stderr: String(stderr || (err && !stderr ? err.message : '')) })
        })
      }),
    isPlaying,
    log,
  }
}
