import { z } from 'zod'

/**
 * Backup targets of a Stage-Server (#363, Marco 2026-10-08): the admin chooses where the server's
 * backups go - one or several targets, so e.g. a ZFS folder and a NAS together (redundancy alone is
 * no backup: a deleted band is deleted on the mirror too).
 *
 * - `folder`: any folder the server can write - a USB stick or second disk (`/media/…`), a ZFS
 *   dataset, or a NAS share the operating system mounts.
 * - `ssh`: a NAS (or any machine) reached over SSH/rsync with the server's own key - nothing to
 *   mount; generations share unchanged backing tracks through hard links.
 */
export const BackupTargetSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(60),
    kind: z.enum(['folder', 'ssh']),
    /** folder: absolute path. */
    path: z.string().trim().max(300).optional(),
    /** ssh: host name or IP, port, user and the folder on the remote side. */
    host: z.string().trim().max(200).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    user: z.string().trim().max(64).optional(),
    remotePath: z.string().trim().max(300).optional(),
    /** Generations kept on this target. */
    keep: z.number().int().min(1).max(60),
    /** Daily at this local time ("HH:MM"), or null for no daily backup. */
    dailyAt: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    /** folder only: back up as soon as the medium is plugged in, when the last success is over a day old. */
    onPlugIn: z.boolean(),
    enabled: z.boolean(),
  })
  .superRefine((t, ctx) => {
    if (t.kind === 'folder' && !(t.path && t.path.startsWith('/'))) ctx.addIssue({ code: 'custom', path: ['path'], message: 'Ordner als absoluter Pfad, z. B. /media/marco/BACKUP' })
    if (t.kind === 'ssh') {
      if (!t.host) ctx.addIssue({ code: 'custom', path: ['host'], message: 'Adresse der NAS fehlt' })
      if (!t.user) ctx.addIssue({ code: 'custom', path: ['user'], message: 'Benutzer fehlt' })
      if (!t.remotePath) ctx.addIssue({ code: 'custom', path: ['remotePath'], message: 'Ordner auf der NAS fehlt' })
    }
  })
export type BackupTarget = z.infer<typeof BackupTargetSchema>

/** What happened on a target last. */
export const BackupTargetStatusSchema = z.object({
  /** Last run that finished successfully (ISO). */
  lastSuccessAt: z.string().nullable(),
  /** Last run, successful or not (ISO). */
  lastRunAt: z.string().nullable(),
  /** Error of the last run, null when it worked. */
  lastError: z.string().nullable(),
  /** Size of the last successful generation in bytes. */
  lastBytes: z.number().nullable(),
  /** A backup to this target is running right now. */
  running: z.boolean(),
  /** folder: the folder is there right now (stick plugged in / disk mounted). Null for ssh. */
  present: z.boolean().nullable(),
})
export type BackupTargetStatus = z.infer<typeof BackupTargetStatusSchema>

/** The admin's view of the server's backups. */
export const BackupOverviewSchema = z.object({
  targets: z.array(z.object({ target: BackupTargetSchema, status: BackupTargetStatusSchema })),
  /** The server's SSH public key - added on the NAS to `~/.ssh/authorized_keys`. */
  publicKey: z.string().nullable(),
})
export type BackupOverview = z.infer<typeof BackupOverviewSchema>

/** Admin routes (/server/backup/...): the admin login of the active band, like other admin routes. */
export const BackupAdminRequestSchema = z.object({
  adminUsername: z.string().min(1),
  adminPassword: z.string().min(1),
})
export const BackupSaveRequestSchema = BackupAdminRequestSchema.extend({ target: BackupTargetSchema })
export const BackupTargetRequestSchema = BackupAdminRequestSchema.extend({ targetId: z.string().min(1) })
