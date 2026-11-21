# Add-on contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the add-on protocol's piecemeal messages with one contract (envelope, mediated capabilities, manifest `contributes`, UI as a description, device state), so add-ons can bring devices, services and UI without the core knowing their domain.

**Architecture:** One envelope in `shared-types` (`request`/`response`, `notify`, `subscribe`/`update`, `ui-set`/`ui-action`); StageBoard mediates every capability (http, udp, helper, audio-store, songs) so a sandboxed add-on holds no `fetch`, file, program or socket. UI is a validated node tree rendered with `components/ui`; view scripts run in the viewer's Worker, work scripts on any device satisfying `runsOn`.

**Tech Stack:** TypeScript strict, Zod (`shared-types`), Node `--permission` child process (`core-backend/src/addons/`), Web Workers + React (`stage-pwa`), Vitest.

**Spec:** `docs/36_Add-on_Vertrag.md` (approved by Marco 2026-11-20 with the proposals of §11: only the core defines slots; no view script on a host without a viewer; the app loads thumbnails from declared origins only; `http` is performed by StageBoard, 8 MB, no streaming).

## Global Constraints

- `npm run verify` green before every commit; never push to `main`, never merge, never deploy; repo text in English, answers to Marco in German.
- Strict TypeScript; every boundary (add-on messages, manifest, UI trees) validated with Zod schemas from `shared-types`.
- Protocol integer `3`; today's `ADDON_PROTOCOL_VERSION = 2` messages keep working through adapters until Task 8.
- UI limits (enforced by the app): depth ≤ 8, ≤ 500 nodes, ≤ 10 `ui-set` per second per slot, ≤ 64 KB per tree. Plain text only, never HTML/Markdown.
- `http` performed by StageBoard: body ≤ 8 MB, no streaming; only origins in the manifest's `permissions`.
- The core must not name any add-on's service (no `youtube`, `ug`, `osc` strings in core code after Task 6/8).
- Real-device claims: say "needs device verification"; never invent measurements.
- Add-on scripts are classic scripts without imports.

## Review Focus

- A request to an origin not in `permissions` (also `http://` vs `https://`, userinfo `a@evil`, redirects to another origin): denied, nothing sent.
- A `ui-set` with an unknown node, 501 nodes, depth 9, an `image` from an undeclared origin: rejected with `ui.*` code, previous tree stays.
- An add-on that answers a request with a body not matching its declared `out` schema, or never answers: error to the caller, the add-on is not trusted further (timeout kills it).
- A newer manifest with an unknown `contributes` kind or unknown node type: ignored with a visible "needs newer StageBoard", no crash.
- A work script that dies mid-job: the job document ends with the add-on's/our error, other add-ons keep running.

## File Structure

- `packages/shared-types/src/addonContract.ts` (new): envelope, error, capability request schemas, `contributes` schema.
- `packages/shared-types/src/addonUi.ts` (new): UI node schema, limits, `validateUiTree`.
- `packages/shared-types/src/addonProtocol.ts` (modify): keep v2 types, add `toEnvelope`/`fromEnvelope` adapters.
- `packages/core-backend/src/addons/capabilities.ts` (new): mediates `http`, `udp`, `helper`; one place that checks permissions.
- `packages/core-backend/src/addons/nodeSandbox.ts`, `scripts/addon_runner.mjs` (modify): no `fetch`; speak envelope.
- `packages/stage-pwa/src/lib/addonUi/` (new): `render.tsx` (node → component), `bind.ts`, `slotHost.tsx`, view-script Worker host.
- `docs/36`, `docs/32` (modify): mark built steps.

---

### Task 1: The envelope and error shape

**Files:**
- Create: `packages/shared-types/src/addonContract.ts`, `packages/shared-types/src/addonContract.test.ts`
- Modify: `packages/shared-types/src/index.ts` (export)

**Interfaces:**
- Produces:
  - `AddonErrorSchema = z.object({ code: z.string().min(1), message: z.string(), params: z.record(z.string(), z.union([z.string(), z.number()])).optional() })`, `type AddonError`
  - `type Envelope = { kind: 'request'; id: number; method: string; body: unknown } | { kind: 'response'; id: number; ok: true; body: unknown } | { kind: 'response'; id: number; ok: false; error: AddonError } | { kind: 'notify'; topic: string; body: unknown } | { kind: 'subscribe'; id: number; stream: string } | { kind: 'update'; id: number; body: unknown } | { kind: 'ui-set'; slot: string; tree: unknown } | { kind: 'ui-action'; slot: string; action: string; value?: unknown }`
  - `EnvelopeSchema` (Zod discriminated union on `kind`), `ADDON_CONTRACT_VERSION = 3`

- [ ] **Step 1: Write failing tests** in `addonContract.test.ts`: `EnvelopeSchema` accepts one valid message of each of the 8 shapes; rejects `{kind:'request', id:'1'}`, an unknown `kind`, and a response with both `ok:true` and `error`; `AddonErrorSchema` rejects an empty `code`.
- [ ] **Step 2:** Run `npx vitest run src/addonContract` in `packages/shared-types`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement the schemas as listed above in `addonContract.ts`; export from `index.ts`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** `git add packages/shared-types && git commit -m "add-ons: the envelope and error shape of the contract (#964)"`

### Task 2: Manifest `contributes` schema

**Files:**
- Modify: `packages/shared-types/src/addonContract.ts`, `addonContract.test.ts`; `packages/shared-types/src/addonRelease.ts` (manifest gets `protocol`, `viewFile`, `workFile`, `contributes`; `clientFile`/`jobsFile` stay as aliases read by the loader)

**Interfaces:**
- Produces: `ContributesSchema` with optional `methods: Record<string,{in: JsonSchema, out: JsonSchema}>`, `jobs: Record<string,{input: JsonSchema, needs?: {helper?: string}}>`, `devices: DeviceContribution[]` (`kind`, `title`, `transport`, `state: Record<string, StateField>`, `commands`), `ui: {slot: SlotId, id: string, title: string, icon?: string}[]`, `settings: JsonSchema`; `SlotId = z.enum(['song-editor.track-source','song-editor.panel','device.panel','settings.section','lookup.source','toolbar.action'])`; `parseContributes(raw): {contributes: Contributes; unknown: string[]}` — keys it does not know are returned in `unknown`, never an error. `JsonSchema = z.record(z.string(), z.unknown())` (checked at call time by Task 3).

- [ ] **Step 1: Failing tests:** a YouTube-like manifest from `docs/36` §3 parses; an unknown top-level key `"holograms"` lands in `unknown` and the rest still parses; an unknown slot id is rejected (slots are API); `protocol` must be an integer ≥ 1.
- [ ] **Step 2:** Run; expect FAIL. **Step 3:** Implement. **Step 4:** Run; PASS (also `npx tsc --noEmit`).
- [ ] **Step 5:** Commit `add-ons: manifest contributes (#964)`.

### Task 3: Method calls validated at the boundary

**Files:**
- Create: `packages/core-backend/src/addons/methodBoundary.ts`, `methodBoundary.test.ts`

**Interfaces:**
- Consumes: `Contributes`, `AddonError` (Tasks 1–2); `NodeSandbox` from `nodeSandbox.ts`.
- Produces: `callMethod(sandbox: {request(method: string, body: unknown, timeoutMs: number): Promise<Envelope>}, contributes: Contributes, method: string, body: unknown): Promise<{ok: true; body: unknown} | {ok: false; error: AddonError}>` — validates `body` against `methods[method].in`, the answer against `.out`; undeclared method → `{code:'method.undeclared'}`; bad input → `{code:'method.input'}`; bad answer → `{code:'method.output'}`. Use `ajv` for JSON-schema checking (add as dependency of core-backend).

- [ ] **Step 1:** Tests with a fake sandbox: valid round trip; undeclared method; input violating `in`; answer violating `out` (error, add-on marked untrusted → `callMethod` returns `method.output` and records it in the returned error params); timeout passes through as `{code:'timeout'}`.
- [ ] **Step 2–4:** Run (fail), implement, run (pass). **Step 5:** commit.

### Task 4: Envelope over the Node sandbox (adapter, no behavior change)

**Files:**
- Modify: `packages/core-backend/src/addons/nodeSandbox.ts`, `scripts/addon_runner.mjs`, `nodeSandbox.test.ts`
- Modify: `packages/shared-types/src/addonProtocol.ts` (add `toEnvelope(msg: FromAddon | ToAddon): Envelope`, `fromEnvelope(e: Envelope): FromAddon | ToAddon | null`)

**Interfaces:**
- Produces: `NodeSandbox.request(method: string, body: unknown, options?: {timeoutMs?: number}): Promise<Envelope>` (response envelope); existing `call`/`runJob` stay and are implemented on `request`. Scripts speaking protocol 2 keep working (runner converts); scripts that declare protocol 3 in `init` speak envelopes directly.

- [ ] **Step 1:** Failing tests: a protocol-3 script answering `request` with `response` round-trips; a protocol-2 script (the existing test scripts) still passes unchanged; `toEnvelope(fromEnvelope(x))` identity for each v2 message with an envelope equivalent.
- [ ] **Step 2–4:** fail, implement, `npx vitest run src/addons` all pass. **Step 5:** commit.

### Task 5: Mediated capabilities — no `fetch` in the sandbox

**Files:**
- Create: `packages/core-backend/src/addons/capabilities.ts`, `capabilities.test.ts`
- Modify: `scripts/addon_runner.mjs` (remove `fetch`, `Headers`, `Request`, `Response`, `AbortController`-with-fetch from the globals; remove `--http` flag), `nodeSandbox.ts` (route capability requests), `scripts/addons/musicbrainz-lookup.js`, `scripts/addons/ultimate-guitar-lookup.js` (use `http` request), `nodeSandbox.test.ts` (the "fetch only with http" test becomes "no fetch ever")

**Interfaces:**
- Produces: `createCapabilities(options: {permissions: readonly string[]; helpers: ReturnType<typeof helperRunnerFor>; fetchImpl?: typeof fetch}): (method: string, body: unknown) => Promise<{ok: true; body: unknown} | {ok: false; error: AddonError}>`, handling `capability.http` (`{url, method?, headers?, body?}` → `{status, headers, body: string}`; ≤ 8 MB; `redirect: 'manual'` and each redirect re-checked against permissions), `capability.udp` (`{host, port, bytes}`), `capability.helper` (`{helper, args, files}`). Origin match is exact on `new URL(url).origin` against `http:<origin>` permissions; any other → `{code:'permission.denied', params:{capability:'http', origin}}`.

- [ ] **Step 1: Failing tests** (Review Focus 1): allowed origin works against a local server; other origin, `http://` vs declared `https://`, `https://allowed@evil.example/`, a 302 to another origin: all `permission.denied` and the local "evil" server records zero requests; body > 8 MB → `{code:'http.too-large'}`; `typeof fetch` inside a sandboxed add-on is `'undefined'` even with `http` permission; the hostile-add-on test still passes.
- [ ] **Step 2–4:** fail, implement, run `npx vitest run src/addons` pass. Migrate MusicBrainz (`fetch` → `request('capability.http', …)`) and keep their tests green. **Step 5:** commit.

### Task 6: UI node schema, validator, limits

**Files:**
- Create: `packages/shared-types/src/addonUi.ts`, `addonUi.test.ts`

**Interfaces:**
- Produces: `UiNodeSchema` (discriminated on `type`: `section`, `card`, `stack`, `row`, `text`{role: body|hint|title|error, text}, `field`, `textarea`, `select`, `slider`, `switch`, `segmented`, `chips`, `checkRow`, `button`{variant, action, label}, `iconButton`, `list`, `listRow`{title, subtitle?, image?, trailing?, action?}, `image`{origin-checked `src`, role: thumb|cover}, `progress`, `badge`, `statusDot`, `dialog`{size: S|M|L}); a value may be `{bind: string}` where the vocabulary allows; `validateUiTree(tree: unknown, ctx: {imageOrigins: readonly string[]}): {ok: true; tree: UiNode} | {ok: false; code: 'ui.unknown-node' | 'ui.too-deep' | 'ui.too-many-nodes' | 'ui.too-large' | 'ui.image-origin' | 'ui.invalid'; path: string}`; constants `UI_LIMITS = {maxDepth: 8, maxNodes: 500, maxBytes: 65536, maxSetsPerSecond: 10}`.

- [ ] **Step 1: Failing tests** (Review Focus 2): the YouTube search dialog tree from `docs/36` §7 validates; unknown node `{type:'iframe'}` → `ui.unknown-node` with path; depth 9 → `ui.too-deep`; 501 nodes → `ui.too-many-nodes`; 65 KB → `ui.too-large`; `<b>` inside `text` stays literal text (no HTML field exists); image from undeclared origin → `ui.image-origin`.
- [ ] **Step 2–4:** fail, implement, pass. **Step 5:** commit.

### Task 7: UI renderer and slot host in the app

**Files:**
- Create: `packages/stage-pwa/src/lib/addonUi/render.tsx`, `bind.ts`, `slotHost.tsx`, `viewWorker.ts`, tests `render.test.tsx`, `slotHost.test.tsx`
- Modify: `packages/stage-pwa/src/lib/addonSandbox/` (view script runs in a Worker via the existing `sandboxHost`, now envelope-speaking through `fromEnvelope`/`toEnvelope`)

**Interfaces:**
- Consumes: `validateUiTree`, `UI_LIMITS`, `Envelope` (Tasks 1, 6); components from `components/ui/index.ts`.
- Produces: `<AddonSlot slot={SlotId} addonId={string} context={Record<string, unknown>} />` — loads the add-on's view script into a Worker, sends `ui-action`, receives `ui-set`, validates, renders; `resolveBind(path: string, sources: {jobs: Record<string, AsyncJob>; state: Record<string, Record<string, unknown>>}): unknown` (`job:<id>.progress`, `state:<device>.<key>`).

- [ ] **Step 1: Failing tests:** each vocabulary node renders its `components/ui` component (role/ARIA asserted); a `ui-set` with an invalid tree keeps the previous tree and surfaces the code in add-on health; 11 `ui-set` within one second → the 11th dropped with `ui.rate`; `bind` updates a `progress` node when the job document changes **without** any message to the worker; a click sends exactly one `ui-action`.
- [ ] **Step 2–4:** fail, implement, `npm run verify -w stage-pwa` pass. **Step 5:** commit.

### Task 8: First slot — YouTube as an add-on (deletes core YouTube)

**Files:**
- Create: `packages/core-backend/scripts/addons/youtube/{view.js,work.js,manifest.json}`
- Modify: `packages/stage-pwa/src/components/TrackManagerField.tsx` (YouTube code replaced by `<AddonSlot slot="song-editor.track-source" …/>`), delete `lib/youtubeSearch.ts`, `useYoutubeRoute.ts`, YouTube parts of `youtubeDevice.ts` once the tablet path uses the same work script; remove `youtube.*` from `serverMessage.ts` and locales; `sync-host` `jobs/youtubeExtract.ts` reduced to the generic "audio arrives → append track → queue Opus convert" job (`audio-import`).

**Interfaces:**
- Consumes: Tasks 3, 5, 7. Produces: a generic job type `audio-import` (`{variantId, label, source: {addonId}}`) whose audio arrives from an add-on method through `audio-store`.

- [ ] **Step 1:** Failing tests: a `TrackManagerField` test opens the "From YouTube" entry via the slot with a stand-in view script and sees search → hit list → pick → progress bound to the job; the add-on's `work.js` through the real sandbox with the stand-in `yt-dlp` and a local HTTP server gives the same 44,184-byte Ogg track as before; a grep test fails if `youtube` appears in `packages/*/src` outside `scripts/addons/youtube`, docs and migration notes.
- [ ] **Step 2–4:** fail, implement, `npm run verify` pass. Tablet path: needs device verification on Fire/Redmi (`tools/host-test/no-laptop.mjs`) — run it and report, do not claim otherwise. **Step 5:** commit.

### Task 9: Device state and `device.panel` (OSC/QLC+ as proof)

**Files:**
- Create: `packages/sync-host/src/host/deviceState.ts` (+test); Modify: OSC add-on (`osc-send.js` → `device` contribution with state), `slotHost.tsx` (`device.panel` slot)

**Interfaces:**
- Produces: `applyStatePatch(doc: DeviceStateDoc, patch: {device: string; key: string; value: unknown}, now: number): DeviceStateDoc` (latest value per key per device; value must match the contributed `state` field schema, else dropped with `{code:'state.invalid'}`), stored in the band's live channel (docs/25 #962).

- [ ] **Step 1:** Failing tests: patch accepted/rejected by schema; two devices of the same band see the same latest value; a `device.panel` bound to `state:qlc.scene` re-renders without add-on round trip. **Steps 2–5** as above; commit.

### Task 10: Remaining add-ons and deletion of the old names

**Files:** stems, speech, UG, MusicBrainz, OSC scripts to the envelope; delete `call`/`job`/`helper-run` v2 messages and adapters from `addonProtocol.ts`, `importAddons.ts`, the plugin catalog entries for them; update `docs/32`, `docs/36` (mark built), `docs/25`.

- [ ] **Step 1:** Failing test: grep-style test that no v2 message type name is referenced outside `addonProtocol.ts`'s deprecated block, then remove it. Run `npm run verify`; commit per add-on.

### Task 11: Open follow-ups (own plans, not here)

Install from a repository (#17), the conformance kit `packages/addon-kit`, option C (`surface` node), hard network denial (Node `--allow-net` or Linux network namespace) to close the documented gap.

---

## Self-review

- Spec coverage: §3 → T2; §4 → T1, T4; §5 → T5, §5a → T9; §6 → T6, T7; §7 → T8; §9 versioning → T2 (`unknown`), T4 (protocol 2 adapter); kit and C → T11 (explicitly later per spec §8, §9). §10 step 7 = T11.
- Names consistent: `Envelope`, `AddonError`, `Contributes`, `validateUiTree`, `UI_LIMITS`, `callMethod`, `createCapabilities`, `AddonSlot`, `resolveBind`.
- Proportion: Tasks 1–7 are detailed because they are independent of YouTube specifics; 8–10 are bigger and will be re-planned at their start from what 1–7 produced.
