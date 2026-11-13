# StageBoard

StageBoard is a modular, local-first live operating system for bands. One shared clock, every musician's tablet shows and plays its part: setlist and chords, click and backing tracks, announcements into the in-ears, MIDI cues to amp modellers, loopers and mixers, light and video over OSC - synchronised over the local network on stage, without the internet.

It is inspired by the modular dashboard approach of Home Assistant: a small core, dashboards made of widgets, and add-ons for the gear a band actually owns.

## How it works

- **Every device holds the whole band.** Songs, setlists, tracks and settings live in a local database on each tablet (PouchDB) and replicate to the others through a host. Losing the network in the middle of a song changes nothing that is already playing.
- **One time base.** All devices agree on the band time (clock sync against the host); clicks, tracks, announcements and cues are scheduled ahead of time on that clock, so two tablets play the same beat within a few milliseconds (docs/29).
- **The stage map configures.** The "Bühne" (stage) tab is a schematic map of the stage: who stands where, which device is connected to which port, and which signal (click, track, Kemper, light) leaves on which cable. The map decides who plays what; cues and songs only know logical signals, never a cable (docs/31).
- **Graceful degradation.** Missing hardware never crashes the UI; widgets go into a disabled state so the musicians' muscle memory stays intact.
- **Three operating tiers** (docs/25): **Solo** - one device, no host; **Band host** - one of the band's own devices (a laptop, later an Android device) hosts sync, clock and tracks; **Stage-Server** - a dedicated box with the heavy add-ons (stem separation, speech synthesis) and, later, redundancy.

## Repository layout

| Package | What |
|---|---|
| `packages/stage-pwa` | the app: React + Vite + TypeScript PWA, also wrapped as the Android app (Capacitor, `android/`) |
| `packages/core-backend` | the host: Fastify server, sync proxy, clock reference, push, tracks, built-in server add-ons |
| `packages/shared-types` | Zod schemas and shared logic used by both (stage map, timing, tracks, plugins) |
| `packages/sync-host` | a small CouchDB-compatible replication host on PouchDB, for hosts without CouchDB |
| `docs/` | concepts, decisions and investigation write-ups - the index with "read when" hints is in [CLAUDE.md](CLAUDE.md) |

## Running it

Node is pinned in `.nvmrc` (use `nvm`). Then:

```sh
npm ci
npm run build --workspaces --if-present
npm run dev            # backend + frontend with hot reload
npm run lint --workspaces --if-present
```

Tablets need a secure context (HTTPS) for the PWA features; the local HTTPS setup, the productive Stage-Server (systemd), the Android build and the deploy steps are in [docs/03](docs/03_Developer_Experience.md).

## Add-ons

StageBoard ships without third-party add-ons. Device drivers, importers and tools are add-ons from their own repositories, chosen per band; add-ons that need code in another language bring a native helper program per platform (on Android: a separate app package). The interface is described in [docs/32](docs/32_Add-on_Schnittstelle.md); the rebuild of the built-in ones is tracked in #755.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Everything in the repository and the issue tracker is in English; many concept docs are still German and are translated as they are touched (#785).

## Licence

Not decided yet (#787). Until then: all rights reserved.
