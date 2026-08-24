/** Shared helpers for building workspace-scoped local/remote database names and URLs. */

export function localDbName(kind: string, workspaceId: string): string {
  return `stageboard-${kind}-${workspaceId}`
}

/** Rewrites VITE_COUCHDB_URL's final path segment to a workspace-scoped database name. */
export function remoteDbUrl(kind: string, workspaceId: string): string | null {
  const base = import.meta.env.VITE_COUCHDB_URL as string | undefined
  if (!base) return null

  const url = new URL(base)
  const segments = url.pathname.split('/').filter(Boolean)
  segments[segments.length - 1] = localDbName(kind, workspaceId)
  url.pathname = `/${segments.join('/')}`
  return url.toString()
}

export function remoteAuth(): { username: string; password: string } {
  return {
    username: import.meta.env.VITE_COUCHDB_USER as string,
    password: import.meta.env.VITE_COUCHDB_PASSWORD as string,
  }
}

/** PUTs the database into existence if it doesn't exist yet (mirrors scripts/setup-couchdb.sh). */
export async function ensureRemoteDbExists(url: string): Promise<void> {
  const { username, password } = remoteAuth()
  const headers = new Headers()
  if (username) headers.set('Authorization', `Basic ${btoa(`${username}:${password}`)}`)

  const response = await fetch(url, { method: 'PUT', headers })
  if (!response.ok && response.status !== 412) {
    throw new Error(`Failed to provision database at ${url}: HTTP ${response.status}`)
  }
}
