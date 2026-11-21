import { existsSync, readFileSync } from 'node:fs'
import { withLegacyPath } from 'sync-host'
import { join } from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { BackupAdminRequestSchema, BackupSaveRequestSchema, BackupTargetRequestSchema, MeasureInputsSaveRequestSchema, MeasureLevelRequestSchema, hostMessage, type MeasureInputsOverview } from 'shared-types'
import type { BackupService } from './backup.js'
import { listAudioInputs, type MeasureInputStore, measureLevel } from './calibration/measureInputs.js'
import { fallbackMicDevice } from './calibration/micCapture.js'
import type { CalibrationRuns } from './calibration/calibrationRuns.js'

/**
 * The jobs only a Node machine does for the band's admins (#962): the backups to a drive and the audio inputs to measure with.
 * They are listed in sync-host's `JOB_ROUTES`, so a device that cannot do them answers 501 with what it lacks; this file is the
 * laptop's answer. Moved out of `index.ts` unchanged.
 */
export interface HostSettingsDeps {
  backups: BackupService
  /** The band this box serves, checked against the caller's admin login; replies itself (409/403) and says false when refused. */
  activeBandAdmin: (request: FastifyRequest, reply: FastifyReply, body: { adminUsername: string; adminPassword: string }) => Promise<boolean>
  measureInputs: MeasureInputStore
  calibrationRuns: CalibrationRuns
}

export function registerHostSettingsRoutes(app: FastifyInstance, deps: HostSettingsDeps): void {
  const { backups, activeBandAdmin, measureInputs, calibrationRuns } = deps
  for (const path of withLegacyPath('/host/backup/overview')) app.post(path, async (request, reply) => {
    const parsed = BackupAdminRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await activeBandAdmin(request, reply, parsed.data))) return reply
    return reply.status(200).send(await backups.overview())
  })
  for (const path of withLegacyPath('/host/backup/save')) app.post(path, async (request, reply) => {
    const parsed = BackupSaveRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await activeBandAdmin(request, reply, parsed.data))) return reply
    backups.save(parsed.data.target)
    return reply.status(200).send(await backups.overview())
  })
  for (const path of withLegacyPath('/host/backup/delete')) app.post(path, async (request, reply) => {
    const parsed = BackupTargetRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await activeBandAdmin(request, reply, parsed.data))) return reply
    backups.remove(parsed.data.targetId)
    return reply.status(200).send(await backups.overview())
  })
  for (const path of withLegacyPath('/host/backup/run')) app.post(path, async (request, reply) => {
    const parsed = BackupTargetRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await activeBandAdmin(request, reply, parsed.data))) return reply
    // Runs in the background (minutes with backing tracks); the app follows it via overview.
    void backups.run(parsed.data.targetId, 'manual').catch((err) => app.log.error({ err }, 'Backup run failed'))
    return reply.status(202).send({ status: 'started' })
  })
  for (const path of withLegacyPath('/host/backup/test')) app.post(path, async (request, reply) => {
    const parsed = BackupTargetRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await activeBandAdmin(request, reply, parsed.data))) return reply
    return reply.status(200).send(await backups.test(parsed.data.targetId))
  })

  // Measuring inputs (docs/24 §7.2, #662): which of the host's audio inputs listens to speakers
  // (microphone) and to headphones / in-ear / Bluetooth (cable) - System → Rig-Check, admins only.
  for (const path of withLegacyPath('/host/measure-inputs/overview')) app.post(path, async (request, reply) => {
    const parsed = BackupAdminRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await activeBandAdmin(request, reply, parsed.data))) return reply
    const overview: MeasureInputsOverview = { inputs: await listAudioInputs(), selected: measureInputs.get(), fallbackMic: fallbackMicDevice() }
    return reply.status(200).send(overview)
  })
  for (const path of withLegacyPath('/host/measure-inputs/save')) app.post(path, async (request, reply) => {
    const parsed = MeasureInputsSaveRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await activeBandAdmin(request, reply, parsed.data))) return reply
    measureInputs.save(parsed.data.selected)
    app.log.info({ selected: parsed.data.selected }, 'Measuring inputs saved')
    return reply.status(200).send({ status: 'ok' })
  })
  for (const path of withLegacyPath('/host/measure-inputs/level')) app.post(path, async (request, reply) => {
    const parsed = MeasureLevelRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await activeBandAdmin(request, reply, parsed.data))) return reply
    // The device is in use while a calibration run records - one at a time.
    if (calibrationRuns.busy()) return reply.status(409).send({ status: 'error', ...hostMessage('calibration.busy') })
    const level = await measureLevel(parsed.data.input, parsed.data.durationMs ?? 2000)
    if (level.error) app.log.warn({ input: parsed.data.input, error: level.error }, 'Measuring input level failed')
    return reply.status(200).send(level)
  })

  // The status line in the app (Geräte → Host): the configured targets' summary; before
  // any target exists, the last run of a hand-started scripts/backup.mjs; null = never set up.
  for (const path of withLegacyPath('/host/backup-status')) app.get(path, async (_request, reply) => {
    const summary = backups.summary()
    if (summary) return reply.status(200).send(summary)
    const file = join(process.env.STAGEBOARD_STATE_DIR ?? './data', 'backup-status.json')
    if (!existsSync(file)) return reply.status(200).send(null)
    try {
      return reply.status(200).send(JSON.parse(readFileSync(file, 'utf8')))
    } catch (err) {
      app.log.warn({ err }, 'backup-status.json unreadable')
      return reply.status(200).send({ ok: false, error: hostMessage('backup.statusUnreadable').message, errorCode: 'backup.statusUnreadable' })
    }
  })
}
