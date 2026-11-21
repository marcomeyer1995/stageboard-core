import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BootstrapSchema, type BandBootstrapStore } from 'sync-host'

/** The join file on the Node host's disk (#933): the platform's half of `BandBootstrapStore`; the rules are sync-host's (#964). */
export function createBandBootstrapStore(stateDir: string): BandBootstrapStore {
  const file = join(stateDir, 'join-band.json')
  return {
    load() {
      try {
        const parsed = BootstrapSchema.safeParse(JSON.parse(readFileSync(file, 'utf-8')))
        return parsed.success ? parsed.data : null
      } catch {
        return null
      }
    },
    save(bootstrap) {
      mkdirSync(stateDir, { recursive: true })
      // It holds the band code: readable by this host's owner only.
      writeFileSync(file, JSON.stringify(bootstrap), { mode: 0o600 })
      chmodSync(file, 0o600)
    },
  }
}
