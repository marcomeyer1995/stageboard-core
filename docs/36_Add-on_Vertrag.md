# 36 – The add-on contract (design, 2026-11-20, #964)

Status: **approved by Marco 2026-11-20. Built (2026-11-20): §4 the envelope (`shared-types/addonContract.ts`), §3 the manifest `contributes`, method calls validated at the boundary (`core-backend/addons/methodBoundary.ts`), the envelope over the Node sandbox, §5 mediated capabilities (`addons/capabilities.ts`: `http`, `udp`, `helper`; the sandbox hands out no `fetch`), §6 the UI vocabulary, validator and limits (`shared-types/addonUi.ts`) and the renderer + slot host (`stage-pwa/lib/addonUi/`). Built too: the first real slot - the YouTube add-on's own dialog in the song editor (§7) - and the generic `audio-import` job. The app runs work scripts too (a Worker host, the Android helper as `yt-dlp`) and the core's own YouTube code is deleted. The other built-in add-ons (look-ups, OSC, speech, stems) are on the contract too and the old job/call/helper messages are deleted (step 6). Device state (§5a) is built on the Node host with OSC as the proof - the tablet-native relay and the stage-map placement of `device.panel` are open (docs/25). Not built yet: -, moving the remaining add-ons, install from a repository. See `docs/superpowers/plans/2026-11-20-addon-contract.md`.** What exists today is described in `docs/32` (manifest, sandboxes, jobs, helpers). This document replaces its piecemeal protocol with one contract and adds what is missing: **UI contributions** and **device state**.

Decisions by Marco (2026-11-20): add-ons act on every level - new devices (a lighting desk, an effects unit, anything that offers state), services (look-ups, importers) **and user interface** (a YouTube add-on needs its own dialog in the song editor). UI comes from add-ons as a **description** (option A); a drawing surface for what a description cannot express (option C) comes later.

## 1. Goals and non-goals

**Goals.** (1) A developer can add a device, a service or a piece of UI without touching StageBoard. (2) The sandbox is *the* boundary: an add-on gets exactly the capabilities the band confirmed, nothing else, and StageBoard enforces them - not the add-on's good manners. (3) The core knows nothing of any add-on's service (no UG format, no YouTube rules, no add-on-specific texts). (4) One small contract, versioned, checkable by a test kit.

**Non-goals now.** Loading add-ons from a repository (#17, separate task); a drawing surface (§8, later); add-ons that run code in the app's page (never).

## 2. The shape of an add-on

An add-on is a **manifest** plus up to two **sandboxed scripts** (classic scripts without imports, as today):

| Part | Runs | Does | Today's name |
|---|---|---|---|
| **view script** | on **every device that shows the add-on**, in a Worker of its own | turns state into UI descriptions, reacts to the person's actions, can call methods | `clientFile` |
| **work script** | on **any device that satisfies `runsOn`**, in a sandbox of its own (Worker on a tablet, Node `--permission` process on a laptop) | answers methods, runs jobs, drives hardware, publishes device state | `jobsFile` |

This split is the point: UI logic runs in the **viewer's** sandbox (fast, offline, no round trip per click), work runs **where it can** (there is no server). The two talk only through StageBoard, as messages.

## 3. The manifest contributes things (VS Code's "contribution points")

```jsonc
{
  "id": "youtube-download", "version": "1.2.0", "protocol": 3,
  "viewFile": "view.js", "workFile": "work.js",
  "runsOn": { "minMemoryMb": 512 },
  "permissions": ["http:www.youtube.com", "helper:yt-dlp", "audio-store"],
  "helpers": ["yt-dlp"],
  "contributes": {
    "methods":  { "search": { "in": {…schema…}, "out": {…schema…} }, "import": { … } },
    "jobs":     { "youtube-extract": { "input": {…}, "needs": { "helper": "yt-dlp" } } },
    "devices":  [ … §5 … ],
    "ui":       [ { "slot": "song-editor.track-source", "id": "yt", "title": "From YouTube", "icon": "youtube" } ],
    "settings": { …schema… }
  }
}
```

- **Everything an add-on contributes is declared**, with a schema (Zod-compatible JSON schema). StageBoard validates *at the boundary*, both ways: an add-on never receives a malformed request and cannot return a malformed answer. The core never looks inside.
- `contributes` is **additive across versions**: a new protocol version may add kinds of contribution; an older StageBoard ignores kinds it does not know and tells the person ("needs a newer StageBoard"), instead of failing.

## 4. One message contract

Today there are `event`, `call`, `job`, `helper-run`, `midi-out`... each added for one case. They become **four message kinds** in one envelope, all with an `id` and a schema-checked `body`:

| Kind | Direction | Meaning | Replaces |
|---|---|---|---|
| `request` / `response` | either | ask something, get one answer or an error `{code, message}` (the add-on's own words) | `call`, `event`+`result`, `job`+`job-result`, `helper-run`+`helper-result` |
| `notify` | either | one-way, no answer (`progress`, `log`, `health`, `state`) | `job-progress`, `log`, `health` |
| `subscribe` / `update` | StageBoard → add-on | a stream of values (device input, band state the add-on may see) | `midi-in` |
| `ui-set` / `ui-action` | add-on ↔ StageBoard | §6 | – |

A **method call** is a `request` whose `method` the manifest declared; a **job** is a long method whose progress and result live in the band's job document (`asyncJob`) so every device sees it; a **helper run** is a `request` *from* the add-on that StageBoard answers by running the declared helper. Same envelope, different `method`.

Errors are `{code, message, params?}`: `code` is stable and machine-readable (what the app can branch on), `message` is the add-on's own text in the language it got in `init`. The core adds none of its own for an add-on's domain.

## 5. Capabilities: what an add-on may ask the world for

The add-on never touches a socket, a file or a program. It **asks** StageBoard, with a `request` for a **capability**; StageBoard checks the manifest's `permissions` (confirmed by the band at install, like Android permissions) and does it - or answers `denied`.

| Capability (permission) | The add-on asks for | Enforced by | Honest limit |
|---|---|---|---|
| `http:<origin>` | a request to exactly that origin (answer read with a cap of 8 MB, as it arrives) | StageBoard performs it (an add-on does *not* get `fetch`) | none - this is the fix for today's gap: Node's permission model cannot cut the network, so the add-on must not hold a network handle at all |
| `udp:<host:port>` / `osc:<host:port>` | one datagram | StageBoard sends | – |
| `midi-out:<port pattern>`, `midi-in:…` | bytes out / a stream in | the page owns WebMIDI; Workers have none. **On a Node host** (2026-11-28, #964): `capability.midi-out` `{bytes, expectReply?}` - StageBoard sends through the machine's own ports (`core-backend/nativeMidi.ts`, the module the Discovery watcher uses too), to the port it **grants for the one cue** it hands over (`midi-out:<port>`, the device's own setting); the add-on names no port, and a manifest without `midi-out` gets nothing. `midi-in` is not built on Node | latency of one message hop (measured against the MG-30 emulator: identity round trip 1-2 ms) |
| `helper:<id>` | run the device's declared helper (yt-dlp, Demucs, Piper, Chrome) | StageBoard starts it in a work folder | helpers are the device's programs, not the add-on's |
| `audio-store` | read/write the band's tracks through methods, not paths | StageBoard | – |
| `songs:read`, `songs:write` | read/change songs through methods | StageBoard (the band's data never enters the sandbox as a database) | – |
| `state:publish`, `state:read:<scope>` | §5a | StageBoard | – |

**What the sandbox itself guarantees** (and no more): the add-on has no file, no program, no environment and - after this change - **no network** of its own; everything above goes through StageBoard. On Node that is `--permission` plus not handing out `fetch`; in the app it is a Worker. *Measured on this laptop, Node 24 (this is what step 2 of §10 changed: the runner no longer hands out `fetch`):* the permission model does not stop sockets, so "no `fetch` in the sandbox" is a convention of the runner and a hostile add-on that escapes the `vm` context could still open one - **until `http` is mediated at the process boundary** (`--allow-net` once Node has it, or a runner without network namespace on Linux). That is the single place where "clean encapsulation" is not yet complete; the doc and the test kit say so.

**Review findings of 2026-11-21, and what was done** (an independent pass over the branch, by hand because the reviewing agent hit its usage limit):
- *Fixed:* the `ug-page` helper refused `tabs.ultimate-guitar.com`, where every tab page of the search results lives - the single-tab import was broken, and the tests missed it because they replace the helper; the host route `POST /addons/:id/methods/:method` handed **every declared method to anyone on the network** (OSC `send` with the target in the body, stem separation, speech) - a method is now reachable by devices only if its manifest says `callableByDevices: true` (the search and detail methods of YouTube, MusicBrainz and Ultimate Guitar), all others are 403 `method.not-callable`; the `http` capability checked the size of an answer only by `content-length` - it now reads as it arrives and stops at the cap (a test proves the server is cut off); the job message to a view script was not an envelope of the contract (`update` without an id) - it is a `notify` now; a start that throws was remembered for good; a view script could put an unbounded label or arguments into a job document that replicates to the whole band - bounded and shaped now (`queueRequestProblem`).
- *Hardened, not solved:* a **browser Worker holds the network in its global scope** (`fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`), unlike the Node sandbox - the contract's "an add-on holds no network handle" was not true in the app. `workerGuard.ts` now removes those APIs from the global and from every prototype above it before the add-on's code runs, in every Worker of the app (device add-ons, view scripts, work scripts). It is a **guard, not a wall**: a dynamic `import('https://...')` is the language and stays. What closes it is a Content-Security-Policy of the page, which StageBoard does not set yet - until then the honest statement is "no network API is handed to an add-on in the app", not "it cannot reach the network". The same is true of Node (`--allow-net` is the missing piece there).
- *Closed afterwards (same day):* the `udp-send` helper sent to any host and port. It is **deleted**; OSC sends through `capability.udp`, and the add-on has no `udp:` permission of its own: StageBoard grants, **for this one call only**, exactly the target the device's own settings name (`grants` on the request, honored only for the `forRequest` the add-on is serving). A hostile add-on that asks for another port, another host, or any target without a request id is refused (tested, and shown to fail when either guard is removed).
- *Known and open:* a view script may call its declared methods without a rate limit - design work, no device needed.

### 5a. Devices and their state

A **device add-on** (lighting desk, effects unit, mixer) contributes:
```jsonc
"devices": [{ "kind": "qlc-plus", "title": "QLC+", "transport": "network-osc",
  "state": { "scene": { "type": "enum", "values": ["a","b"] }, "level": { "type": "number", "min": 0, "max": 1 } },
  "commands": { "setScene": { "in": { … } } } }]
```
The work script `notify`s `state` patches (`{device, key, value}`); StageBoard keeps the **latest value per key per device** in the band's live channel (docs/25 #962) so every device sees it, and the UI binds widgets to it (§6). A command is a method; the show-control gateway keeps its timing (`scheduledAt`, docs/32 §5) - the add-on does not decide *when*, it only turns the event into bytes.

## 6. UI contributions - option A: a description, not code

The view script answers with a **tree of StageBoard's own building blocks**; the app renders it with the components of `docs/15` §6 (`components/ui/`), so themes, touch sizes, keyboard handling and accessibility apply automatically. The add-on has no DOM, no markup, no styles, no access to the page.

**Vocabulary (v1)**, each a node `{type, …props, children?}`, and each exactly one existing component:

| Node | Component | Notes |
|---|---|---|
| `section`, `card`, `stack`, `row` | `Section`, `Card`, `Layout` | layout, no free sizing - the app decides spacing |
| `text` (`body`, `hint`, `title`, `error`) | typography roles | **plain text only**, never HTML/Markdown from the add-on |
| `field`, `textarea`, `select`, `slider`, `switch`, `segmented`, `chips`, `checkRow` | `Field`, … | value in, `change` action out |
| `button` (`primary`, `secondary`, `danger`, `quiet`), `iconButton` | `Button`, `IconButton` | `action: "id"` |
| `list`, `listRow` (title, subtitle, leading image, trailing, `action`) | `ListRow` | the YouTube hit list |
| `image` | thumbnail | **only** from an `http:` origin the add-on declared; the **app** loads it (no add-on-chosen request leaves the device from the page, so no IP leak to arbitrary hosts); size is a role (`thumb`, `cover`), not pixels |
| `progress`, `badge`, `statusDot` | `Badge`, `StatusDot` | bound to a job or a state value |
| `dialog` (size S/M/L) | `Dialog` | a slot may open one |
| `bind` | – | `{ bind: "job:abc.progress" }` / `{ bind: "state:qlc-1.scene" }` instead of a literal: the app keeps it live, **without a round trip to the add-on** |

**Interaction.** The person acts → the app sends `ui-action {slot, action, value}` to the view script → it answers with a new `ui-set` for that slot (a full tree, replaced; the app diffs). A search result list that changes is a new tree. **Limits** the app enforces: depth ≤ 8, ≤ 500 nodes, ≤ 10 `ui-set` per second per slot, ≤ 64 KB per tree. Anything outside the vocabulary is rejected with `{code: "ui.unknown-node"}` and shown to the developer in the add-on's health line (§9 of docs/32).

**Slots (v1)** - the places an add-on may fill; each slot defines what the app hands in (`context`) and what the add-on may do:

| Slot | Where | Context in | May |
|---|---|---|---|
| `song-editor.track-source` | "+ Add track" in the song editor | the song/variant id | return a tree for its dialog; start a job; the finished track appears in the song by StageBoard's own job → track path |
| `song-editor.track-action` | an action on one track of the song (a button on the track's row; the add-on's dialog replaces nothing) | the song, the track, whether it already has stems | show a tree; `core.queueStemSeparation` |
| `song-editor.panel` | a tab in the editor | the song | show a tree |
| `device.panel` | a device's page on the stage map | the device and its state | bind widgets to state; send commands |
| `settings.section` | band/device settings | the add-on's settings | edit its own `settings` |
| `lookup.source` | the song-import dialog | the query | a result list; the chosen result becomes ChordPro/metadata via a method |
| `toolbar.action` | a quiet button | the current view | start a method |

A new slot is a StageBoard change (slots are API); a new building block is a StageBoard change. That is deliberate: the vocabulary grows by what several add-ons need, and every addition ships with its component and its accessibility.

## 7. Worked example: the YouTube add-on, with **no YouTube in the core**

- Manifest contributes `ui` slot `song-editor.track-source` ("From YouTube"), methods `search`, `import`, job `youtube-extract`, permissions `http:www.youtube.com`, `helper:yt-dlp`, `audio-store`.
- **View script** (in the viewer's sandbox): on open returns `dialog{ field(query), button(Search) }`; on `action: search` calls method `search` (answered by the work script on some capable device or the tablet's own), returns `list` of `listRow{image(thumb), title, subtitle: "4:12"}`; on `action: pick` calls `import`, which queues the job; returns `row{ text, progress{ bind: "job:<id>.progress" } }`.
- **Work script** (where `yt-dlp` exists): `search` → the page parsed *by the add-on*, `import` → asks for helper `yt-dlp`, hands the audio back to `audio-store`. All YouTube rules (links, size limit, the words for errors) live here.
- The core provides only: the slot, the dialog, the `ListRow`s, the job document, "audio arrives → append a track (and convert it to Opus)". Today's `TrackManagerField` YouTube code, `youtube.*` messages, `isYoutubeUrl` and the recipe in sync-host become the add-on.

## 8. Later - option C: the drawing surface

A node `surface {w, h}` gives the add-on an `OffscreenCanvas` of a fixed size in its own Worker (2D only), plus pointer events as messages. For what a description cannot say (a waveform, a mixer's meter bridge). Built **when a real add-on cannot be written with §6**, not before; the contract above already leaves the node name and the `ui-action` path free for it.

## 9. Versioning and the test kit

- `protocol` in the manifest is an integer; StageBoard runs add-ons of every protocol it knows and says so in the install dialog when it does not.
- **Conformance kit** (`packages/addon-kit`, later published): types generated from the schemas, a local harness that runs a view/work script in the real sandbox with a fake band, a recorder of every message, and the **hostile-add-on test** of today as a regression suite for the boundary.

## 10. Migration (steps; each ends green with `npm run verify`)

1. **Contract in `shared-types`:** the envelope, the four kinds, error shape, manifest `contributes` schema; today's messages become thin adapters. *No behavior change.*
2. **Mediated capabilities:** `http`, `udp`, `helper`, `audio-store` as requests; remove `fetch` from the runner; MusicBrainz and UG move to `http` requests. Closes the network gap above as far as Node allows.
3. **UI renderer:** the node vocabulary, the validator and limits, the `bind` mechanism, slot host in the app (view script in a Worker), tests with a fake add-on.
4. **First slot, one add-on:** `song-editor.track-source` with the YouTube add-on (this deletes the YouTube code from `TrackManagerField` and the `youtube.*` texts from the core).
5. **Device state:** `state` notifies, the live channel, `device.panel`; one device (OSC/QLC+) as the proof.
6. **Remaining add-ons** (stems, speech, UG, MusicBrainz) onto the contract; delete the old message names and `importAddons.ts`.
7. Then: install from a repository (#17), the conformance kit, and C if a case demands it.

## 11. Open questions (to decide before step 3)

- **Slots owned by the core vs. proposed by add-ons.** Proposal: only the core defines slots (above). Risk: a good add-on idea waits for a StageBoard release. Mitigation: slots are cheap, and each one is a doc paragraph plus one component.
- **Where does the add-on's view script run on the host (no viewer)?** Proposal: it does not - UI exists only where someone looks at it.
- **Thumbnails.** `image` loaded by the app from a declared origin leaks the viewer's IP to that origin (YouTube sees it anyway when a person uses the add-on). Alternative: the work script fetches and hands the bytes over (heavier, works offline for a cached search). Proposal: the app loads, from declared origins only.
- **`http` as a StageBoard-performed request** costs body size limits and no streaming. Proposal: 8 MB, no streaming in v1; large files go through a helper.
