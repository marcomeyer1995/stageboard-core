/**
 * The paths of a host's own routes (#964). They used to begin with `/server/` (and `/server-info`): a host is not a host, any device can be one, so they
 * now all begin with `/host/`. An app built before the change still asks the old path, so every old path answers too, as an alias of its new one -
 * until no such app is left.
 */
export const LEGACY_HOST_PATHS: Readonly<Record<string, string>> = {
  '/host/info': '/server-info',
  '/host/active-workspace': '/server/active-workspace',
  '/host/active-workspace/admins': '/server/active-workspace/admins',
  '/host/lease-status': '/server/host-lease',
  '/host/backup/overview': '/server/backup/overview',
  '/host/backup/save': '/server/backup/save',
  '/host/backup/delete': '/server/backup/delete',
  '/host/backup/run': '/server/backup/run',
  '/host/backup/test': '/server/backup/test',
  '/host/backup-status': '/server/backup-status',
  '/host/measure-inputs/overview': '/server/measure-inputs/overview',
  '/host/measure-inputs/save': '/server/measure-inputs/save',
  '/host/measure-inputs/level': '/server/measure-inputs/level',
}

/** A path and, if it has one, its legacy alias - what a route registers under. */
export const withLegacyPath = (path: string): string[] => (LEGACY_HOST_PATHS[path] ? [path, LEGACY_HOST_PATHS[path]!] : [path])
