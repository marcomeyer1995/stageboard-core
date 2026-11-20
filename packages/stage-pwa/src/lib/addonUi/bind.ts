/** What a `{bind: "..."}` in a UI tree can read: the band's jobs and the devices' state (docs/36 §6). The app keeps them live; the add-on is not asked again. */
export interface BindSources {
  jobs: Record<string, Record<string, unknown>>
  state: Record<string, Record<string, unknown>>
}

const own = (object: Record<string, unknown> | undefined, key: string): unknown => (object && Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined)

/** `job:<id>.<field>` or `state:<device>.<key>` - the value, or `undefined` for anything unknown (only own properties are read). */
export function resolveBind(path: string, sources: BindSources): unknown {
  const match = /^(job|state):([^.]+)\.(.+)$/.exec(path)
  if (!match) return undefined
  const [, kind, id, key] = match
  return own(own(kind === 'job' ? sources.jobs : sources.state, id!) as Record<string, unknown> | undefined, key!)
}
