/**
 * The bands a device holds, from the names of its IndexedDB databases (PouchDB prefixes each with `_pouch_`; a band's is
 * `stageboard-<id>`). The app also keeps placeholders that are no band - `stageboard-` and `stageboard-default`, what its
 * database holds before any band is chosen - so they never count: a fresh tablet holds no band, and the first band founded
 * on it is free (#962).
 */
const PREFIX = '_pouch_stageboard-'
const NOT_BANDS = new Set(['', 'default'])

export function bandIdsFromDatabases(names: readonly (string | undefined)[]): string[] {
  const ids = new Set<string>()
  for (const name of names) {
    if (!name?.startsWith(PREFIX)) continue
    const id = name.slice(PREFIX.length)
    // Backups of deleted bands (`stageboard-deleted-<band>-<time>`) are no band either.
    if (NOT_BANDS.has(id) || id.startsWith('deleted-')) continue
    ids.add(id)
  }
  return [...ids]
}
