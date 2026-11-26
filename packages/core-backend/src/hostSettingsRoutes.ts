import { existsSync, readFileSync } from 'node:fs'
import { withLegacyPath, type HostRoute, type HostRouteRequest, type HostRouteResponse } from 'sync-host'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { z } from 'zod'
import { BackupAdminRequestSchema, BackupSaveRequestSchema, BackupTargetRequestSchema, MeasureInputsSaveRequestSchema, MeasureLevelRequestSchema, hostMessage, type MeasureInputsOverview } from 'shared-types'
import type { BackupService } from './backup.js'
import { listAudioInputs, type MeasureInputStore, measureLevel } from './calibration/measureInputs.js'
import { fallbackMicDevice } from './calibration/micCapture.js'
import type { CalibrationRuns } from './calibration/calibrationRuns.js'
import { registerHostRoutes } from './hostRoutes.js'

/**
 * The jobs only a Node machine does for the band's admins (#962): the backups to a drive and the audio inputs to measure with.
 * They are listed in sync-host's `JOB_ROUTES`, so a device that cannot do them answers 501 with what it lacks; this file is the
 * laptop's answer - a route table of the Node shell (#964, step 2), the shape every host's routes have.
 */
export interface HostSettingsDeps {
  backups: BackupService
  /** The band this box serves, checked against the caller's admin login: the refusal (409 no band, 403 not its admin), or null. */
  activeBandAdmin: (remoteAddress: string | undefined, body: { adminUsername: string; adminPassword: string }) => Promise<HostRouteResponse | null>
  measureInputs: MeasureInputStore
  calibrationRuns: CalibrationRuns
  log: { info: (meta: Record<string, unknown>, msg: string) => void; warn: (meta: Record<string, unknown>, msg: string) => void; error: (meta: Record<string, unknown>, msg: string) => void }
}

const ok = (body: unknown, status = 200): HostRouteResponse => ({ status, body })

export function hostSettingsRoutes(deps: HostSettingsDeps): HostRoute[] {
  const { backups, activeBandAdmin, measureInputs, calibrationRuns, log } = deps
  /** An admin route: the body checked against its schema, then the caller against the active band's admins. */
  const admin = <S extends z.ZodType<{ adminUsername: string; adminPassword: string }>>(path: string, schema: S, answer: (body: z.infer<S>) => Promise<HostRouteResponse>): HostRoute[] =>
    withLegacyPath(path).map((pattern) => ({
      method: 'POST' as const,
      pattern,
      handle: async (request: HostRouteRequest) => {
        const parsed = schema.safeParse(request.body)
        if (!parsed.success) return { status: 400, body: { status: 'error', message: parsed.error.issues[0]?.message } }
        const refused = await activeBandAdmin(request.remoteAddress, parsed.data)
        return refused ?? answer(parsed.data)
      },
    }))

  return [
    ...admin('/host/backup/overview', BackupAdminRequestSchema, async () => ok(await backups.overview())),
    ...admin('/host/backup/save', BackupSaveRequestSchema, async (body) => {
      backups.save(body.target)
      return ok(await backups.overview())
    }),
    ...admin('/host/backup/delete', BackupTargetRequestSchema, async (body) => {
      backups.remove(body.targetId)
      return ok(await backups.overview())
    }),
    // Runs in the background (minutes with backing tracks); the app follows it via overview.
    ...admin('/host/backup/run', BackupTargetRequestSchema, async (body) => {
      void backups.run(body.targetId, 'manual').catch((err) => log.error({ err }, 'Backup run failed'))
      return ok({ status: 'started' }, 202)
    }),
    ...admin('/host/backup/test', BackupTargetRequestSchema, async (body) => ok(await backups.test(body.targetId))),

    // Measuring inputs (docs/24 §7.2, #662): which of the host's audio inputs listens to speakers (microphone) and to headphones /
    // in-ear / Bluetooth (cable) - System → Rig-Check, admins only.
    ...admin('/host/measure-inputs/overview', BackupAdminRequestSchema, async () => {
      const overview: MeasureInputsOverview = { inputs: await listAudioInputs(), selected: measureInputs.get(), fallbackMic: fallbackMicDevice() }
      return ok(overview)
    }),
    ...admin('/host/measure-inputs/save', MeasureInputsSaveRequestSchema, async (body) => {
      measureInputs.save(body.selected)
      log.info({ selected: body.selected }, 'Measuring inputs saved')
      return ok({ status: 'ok' })
    }),
    ...admin('/host/measure-inputs/level', MeasureLevelRequestSchema, async (body) => {
      // The device is in use while a calibration run records - one at a time.
      if (calibrationRuns.busy()) return { status: 409, body: { status: 'error', ...hostMessage('calibration.busy') } }
      const level = await measureLevel(body.input, body.durationMs ?? 2000)
      if (level.error) log.warn({ input: body.input, error: level.error }, 'Measuring input level failed')
      return ok(level)
    }),

    // The status line in the app (Geräte → Host): the configured targets' summary; before any target exists, the last run of a
    // hand-started scripts/backup.mjs; null = never set up.
    ...withLegacyPath('/host/backup-status').map((pattern) => ({
      method: 'GET' as const,
      pattern,
      handle: async (): Promise<HostRouteResponse> => {
        const summary = backups.summary()
        if (summary) return ok(summary)
        const file = join(process.env.STAGEBOARD_STATE_DIR ?? './data', 'backup-status.json')
        if (!existsSync(file)) return ok(null)
        try {
          return ok(JSON.parse(readFileSync(file, 'utf8')))
        } catch (err) {
          log.warn({ err }, 'backup-status.json unreadable')
          return ok({ ok: false, error: hostMessage('backup.statusUnreadable').message, errorCode: 'backup.statusUnreadable' })
        }
      },
    })),
  ]
}

/** The host settings on a Fastify listener. */
export function registerHostSettingsRoutes(app: FastifyInstance, deps: HostSettingsDeps): void {
  registerHostRoutes(app, hostSettingsRoutes(deps))
}
