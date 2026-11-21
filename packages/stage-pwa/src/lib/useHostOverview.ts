import { useEffect, useState } from 'react'
import { useBandSettingsStore } from '../store/useBandSettingsStore'
import { useHostUrlStore } from '../store/useHostUrlStore'
import { probeHost } from './hostFollow'
import { describeHosts, type HostOverview, type HostProbe } from './hostOverview'
import { getHostUrl } from './hostUrl'

/** While the map's "Prüfen" is open only - a host that is on standby should see next to no traffic. */
const POLL_MS = 3_000

/**
 * The stage map's host overview (#941): asks every host of the band's list what it announces on `/time`
 * and describes who is the host, who stands by and what is wrong. Null while off, without two listed
 * hosts, or before the first answer. Polls only while `active`.
 */
export function useHostOverview(active: boolean): HostOverview | null {
  const hosts = useBandSettingsStore((state) => state.settings.hosts)
  // The address this device is on can change (the follower moves it); it must follow.
  const serverOverride = useHostUrlStore((state) => state.url)
  const [overview, setOverview] = useState<HostOverview | null>(null)

  useEffect(() => {
    if (!active || !hosts || hosts.length < 2) {
      setOverview(null)
      return
    }
    let alive = true
    const poll = async () => {
      const entries = await Promise.all(hosts.map(async (h) => [h.url, (await probeHost(h.url)) as HostProbe | null] as const))
      if (alive) setOverview(describeHosts(hosts, Object.fromEntries(entries), getHostUrl()))
    }
    void poll()
    const timer = setInterval(() => void poll(), POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [active, hosts, serverOverride])

  return overview
}
