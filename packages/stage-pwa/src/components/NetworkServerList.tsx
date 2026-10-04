import { useEffect, useState } from 'react'
import { discoverServers, pairWithServer, serverFingerprint, shortFingerprint, type FoundServer } from '../lib/native'
import { useDialogStore } from '../store/useDialogStore'

/**
 * Native app (#351): the Stage-Servers announcing themselves on the local network - tap one to
 * connect. Finding a server isn't trusting it: connecting reads the certificate the server really
 * presents and asks to confirm its fingerprint, exactly as for a typed-in address.
 */
export function NetworkServerList({ autoSearch = false, onPaired }: { autoSearch?: boolean; onPaired?: () => void }) {
  const confirm = useDialogStore((state) => state.confirm)
  const [servers, setServers] = useState<FoundServer[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function search() {
    setSearching(true)
    setError(null)
    try {
      setServers(await discoverServers())
    } catch {
      setServers([])
    }
    setSearching(false)
  }

  useEffect(() => {
    if (autoSearch) void search()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function connect(server: FoundServer) {
    setError(null)
    let fingerprint: string
    try {
      fingerprint = await serverFingerprint(server.host)
    } catch {
      setError(`${server.name} antwortet nicht.`)
      return
    }
    if (!(await confirm(`Mit ${server.name} (${server.host}) verbinden? Zertifikat: ${shortFingerprint(fingerprint)} – auf dem Admin-Gerät unter „Einladen“ vergleichbar.`, { confirmLabel: 'Verbinden' }))) return
    await pairWithServer(server.host, fingerprint)
    onPaired?.()
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-ink-muted">Stage-Server im Netzwerk</span>
        <button type="button" disabled={searching} onClick={() => void search()} className="min-h-12 rounded-sb-sm bg-control-strong px-3 text-sm font-semibold text-ink disabled:opacity-50">
          {searching ? 'Sucht…' : 'Suchen'}
        </button>
      </div>
      {servers?.length === 0 && !searching && <p className="text-sm text-ink-faint">Keiner gefunden – Adresse eingeben oder QR-Code scannen.</p>}
      {servers?.map((server) => (
        <button
          key={`${server.name}@${server.host}`}
          type="button"
          onClick={() => void connect(server)}
          className="flex min-h-12 items-center justify-between gap-2 rounded-sb bg-control px-3 text-left text-base text-ink hover:bg-control-hover"
        >
          <span className="font-semibold">{server.name}</span>
          <span className="text-sm text-ink-muted">{server.host}</span>
        </button>
      ))}
      {error && <p className="text-sm text-amber-500">{error}</p>}
    </div>
  )
}
