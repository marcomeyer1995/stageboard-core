/**
 * What the host-local commands (band:delete, admin:reset - #70) run with: the Host
 * service's own environment (database login, state folder), so they work from a plain shell
 * without retyping any credential.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import type { DatabaseConfig } from '../database.js'

/** The service's environment (STAGEBOARD_DB_*, STAGEBOARD_STATE_DIR) when the command isn't started
 * with it already - read from the systemd user unit, kept in this process only. */
export function serviceEnvironment(): Record<string, string> {
  try {
    const out = execFileSync('systemctl', ['--user', 'show', 'stageboard', '--property=Environment', '--value'], {
      encoding: 'utf8',
    })
    const env: Record<string, string> = {}
    for (const match of out.matchAll(/(?:^|\s)([A-Z_][A-Z0-9_]*)=("[^"]*"|\S*)/g)) {
      env[match[1]] = match[2].replace(/^"|"$/g, '')
    }
    // The database login lives in an EnvironmentFile (~/.config/stageboard/database.env), not in the
    // unit itself - read those files too (systemctl lists them as "path (ignore_errors=…)").
    const files = execFileSync('systemctl', ['--user', 'show', 'stageboard', '--property=EnvironmentFiles', '--value'], { encoding: 'utf8' })
    for (const path of files.split('\n').map((line) => line.replace(/\s*\(.*\)\s*$/, '').trim()).filter(Boolean)) {
      if (!existsSync(path)) continue
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        const match = /^\s*([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line)
        if (match) env[match[1]] = match[2].trim().replace(/^"|"$/g, '')
      }
    }
    return env
  } catch {
    return {}
  }
}

/** Fills STAGEBOARD_DB_* / STAGEBOARD_STATE_DIR from the service where the shell doesn't set them, and
 * returns the database login the host itself uses. */
export function serverDatabaseConfig(): DatabaseConfig {
  const service = serviceEnvironment()
  for (const key of ['STAGEBOARD_DB_URL', 'STAGEBOARD_DB_USER', 'STAGEBOARD_DB_PASSWORD', 'STAGEBOARD_STATE_DIR']) {
    if (!process.env[key] && service[key]) process.env[key] = service[key]
  }
  return {
    url: process.env.STAGEBOARD_DB_URL ?? 'http://localhost:5984',
    user: process.env.STAGEBOARD_DB_USER ?? 'admin',
    password: process.env.STAGEBOARD_DB_PASSWORD ?? 'admin',
  }
}
