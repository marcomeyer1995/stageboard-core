# 34 - Host architecture at a glance (#962)

*Written 2026-11-19 after #960 and #962. A map for newcomers; the reasons and the measurements stay in docs/25. Diagrams are Mermaid (GitHub renders them). Where a box says "not built", it is a gap, not a plan.*

**The one idea:** there is no "server" in the old sense. A **host** is a role any device can take. The code of a host lives once, in `sync-host`; a platform adds only a transport (how bytes arrive) and storage (where documents live). What a device can do on top is decided by the device alone and said by `GET /host/capabilities`.

## 1. Who owns what

```mermaid
flowchart LR
  subgraph shared["shared-types (Zod schemas, no behaviour)"]
    ST[Request/response schemas<br/>HostCapabilities, AccessCode, ...]
  end

  subgraph core["sync-host (the host, once)"]
    DB[databaseHost / createSyncHost<br/>PouchDB protocol + write guard]
    RT[routes.ts - ONE route table]
    BC[bandCatalog + bandRoutes<br/>found / list / delete / rename / code]
    AC[bandAccounts / join / members<br/>logins + PINs as band documents]
    CH[channels - HostChannels port<br/>show state, switches, health,<br/>presence, OSC, trigger, Discovery]
    LS[leaseService + hostClock<br/>who is the band host, band time]
    CP[capabilities.ts<br/>JOB_ROUTES, refusalFor, unmetRequirement]
  end

  subgraph laptop["core-backend (Node, Fastify) - a thin transport + what only Node can do"]
    FA[Fastify: HTTP/2, TLS, SSE, /db proxy]
    LB[createLaptopBandStore<br/>over LevelDB]
    JOBS[jobs: backup, stems, speech,<br/>yt-dlp, lookup, OSC UDP, MIDI]
  end

  subgraph tablet["stage-pwa (React + Capacitor) - the same app is a host"]
    LH[localHost.ts + hostHttp.ts<br/>answers requests from the native server]
    TB[createTabletBandStore<br/>over IndexedDB]
    NAT[LocalHostPlugin.java<br/>TLS, clock, SSE relay]
    TC[tabletCapabilities.ts]
  end

  ST --> core
  FA --> RT
  LH --> RT
  NAT --> LH
  RT --> BC & AC & CH & LS & CP
  LB -. BandStore port .-> BC
  TB -. BandStore port .-> BC
  JOBS -. capability .-> CP
  TC -. capability .-> CP
```

Rule of thumb for a new function: **if it is a rule about a band, it belongs in `sync-host` over a small port. If it needs an operating-system tool (a binary, a UDP port, a drive), it is a *job* - it goes behind a capability, and the host that cannot do it answers 501.**

## 2. A request, on either host

```mermaid
sequenceDiagram
  participant P as Phone (any device)
  participant T as Transport<br/>(Fastify or native server)
  participant R as sync-host route table
  participant G as band guard (404/503)
  participant H as handler / BandStore / HostChannels

  P->>T: POST /workspaces/:band/show-state/push
  T->>R: matchHostRoute(method, path)
  R->>R: 1. body valid? (Zod) else 400
  R->>G: 2. does this host serve :band? else 404
  G->>G: 3. is it serving it now (lease)? else 503
  R->>H: 4. login is a device of the band? else 401
  H-->>P: 204 (and the push fans out to listeners)
  Note over T,R: A job path (e.g. /server/backup/run) is checked<br/>against capabilities FIRST -> 501 capability_missing
```

The order is deliberate: a stranger learns nothing from a 400, nothing about which bands exist from a 403, and a device that cannot do a job is told *what is missing* instead of getting a misleading 404.

## 3. Roles over time: one band host at a time

```mermaid
stateDiagram-v2
  [*] --> Passive: switch on, listed as backup
  Passive --> Active: primary silent (about 5 s) and not reachable
  Active --> Passive: primary is back and steady (hand-back)
  Active --> Active: serves band time, DB, channels
  note right of Passive
    answers who it is, the lease, capabilities;
    503 for the band's data
  end note
  note right of Active
    a band the host FOUNDED itself is served
    whatever the lease says (servedBands)
  end note
```

- **Epoch** rises on every takeover; devices follow the highest epoch (`useHostFollower`).
- **Band time** is the primary's clock; the backup keeps a measured offset to it (`hostClock`), so a takeover does not make the beat jump.
- **Open:** a locked tablet screen can stop the host (docs/25 §6g); the native beat was rejected, keep the tablet awake and in front.

## 4. Where a job goes (capabilities)

```mermaid
flowchart TD
  A[Device wants a job:<br/>stem separation, speech, backup, ...] --> B{GET /host/capabilities<br/>of the hosts it knows}
  B -->|a host lists the job available| C[send the job there]
  B -->|none can| D[show the host's note:<br/>what is missing, why slow,<br/>how to improve]
  C --> E[host answers the job route]
  E -->|device lacks it after all| F[501 capability_missing<br/>never 404]
```

| Job (in `JOB_ROUTES`) | Laptop | Tablet |
|---|---|---|
| backup, measure-inputs, calibration, lookup, plugin runtime, add-on install, hardware, OSC in | yes (Node) | not built yet (feasible) |
| speech (Piper) | if `piper` is installed | not built yet; clips are cached forever, a slow first run costs once |
| YouTube download | if `yt-dlp` is installed | **runs on the tablet itself** through the Android helper; not yet *for other devices* |
| stem separation | if `demucs` is installed | not built; measure first (docs/25: Phone ~2/3 of the laptop's single thread, Fire ~1/7) |

## 5. Data: one database, same code everywhere

- Every band is a PouchDB database `stageboard-<id>`; devices replicate with the host over the CouchDB protocol that `sync-host` implements. No CouchDB anywhere (#960).
- Logins and PINs are documents *of the band* (`account:*`, `anchor:*`), written only by `_admin` or a device the band lists as a host. A host can therefore be replaced without losing accounts.
- Revision history is bounded (`revs_limit: 50`, auto-compaction) on host and device after the first soak run showed an unbounded history slowing the host down (docs/25).
- The first band on a host is free; further bands need an admin login of a band on that host (or the laptop's own loopback). A deleted band is copied first and never founded again.

## 6. What is not built, and where the gaps are

| Gap | Why it matters | Where it is written |
|---|---|---|
| Tablet clock, `/time` and lease follow only the *active* band | a second founded band syncs but has no band time of its own | docs/25 (#962 step 1) |
| Streams the native relay does not carry (plugin health, OSC, Discovery, device trigger) | a tablet answers 501 for them | docs/25 (#962 step 2) |
| `LocalHostPlugin.java` knows the lease flag and `servedBands`, nothing finer | changes there need a real device | docs/25 |
| The app does not yet choose a host for a job by itself | step 4/6 of #962 is the rule, not the routing UI | docs/25 |
| Locked screen stops a tablet host | a band that runs on a tablet needs it awake | docs/25 §6g |
| `core-backend/src/index.ts` (about 1400 lines) still wires many routes by hand | candidates to move into the table as jobs | cleanup list |

## 7. Reading order

1. docs/25 (decisions and measurements, newest first at the top of the #962 paragraphs).
2. `packages/sync-host/src/host/routes.ts` - the whole public surface of a host in one file.
3. `packages/sync-host/src/host/capabilities.ts` - which requests need a capable device.
4. `packages/stage-pwa/src/host/localHost.ts` - how a tablet wires the same pieces.
5. `tools/host-test/no-laptop.mjs` - the executable description of what a host must do.
