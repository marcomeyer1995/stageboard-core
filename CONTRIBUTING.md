# Contributing to StageBoard

## Language

Everything in the repository and in the issue tracker is written in **English**: code, comments, commit messages, pull requests, issues, docs and READMEs. UI strings live in the i18n files under `packages/stage-pwa/src/i18n/locales/` - keep `de` and `en` in step. Older concept docs in `docs/` are still German; translate a doc when you touch it (one PR per doc), and write new docs in English.

## Workflow

1. **Issue first.** Every change starts from a GitHub issue that says why, what, and how it is accepted. Tracking issues per area: stage map #737, add-ons #755, audio engine #773, host tiers #777.
2. **Small branches, draft PRs.** Branch from `main`, keep commits small and testable, open the PR as a draft and describe what was done, what was tested on which device, and what is left. The maintainer merges; `main` requires the CI check (`build-test`) to pass.
3. **Before you push:** `npm run lint --workspaces --if-present` (includes test files) and the type check. For `packages/stage-pwa` use `tsc -b` - `tsc --noEmit -p tsconfig.json` silently checks nothing there.
4. **Commit messages:** `<area>: <what changed>` in English, e.g. `stage map: container ports and pins (#739)`. Reference the issue.

## Code

- TypeScript, 100 % strict. Validate every boundary (replication documents, plugin messages, HTTP) with Zod schemas from `shared-types`.
- Match the surrounding code: comment density, naming, idiom. Comments say *why*, not *what*.
- No native browser dialogs (`alert`, `confirm`, `prompt`) in the app - use the in-app dialog system (docs/15).
- UI follows the UI system in docs/15 (tokens, shared components in `components/ui/`, size tiers); the guard test enforces it. Everything on stage is big: touch targets ≥ 48 px, text ≥ 16 px.
- Audio, timing and clock code: read docs/29 and docs/30 first; for DSP or algorithmic claims, measure against ground truth before calling it done.
- Backend errors are logged in detail as JSON.

## Testing

- Unit tests with Vitest next to the code (`*.test.ts`). Hardware is mocked (docs/03 §2); for MIDI devices use the virtual rigs in "Device Emulators" rather than hand-written mock data.
- Changes to playback, click, timing or the native app are verified on real devices (Fire HD 10, a MediaTek tablet, a phone) before merging; the methods are in docs/09, docs/19, docs/24 and docs/30, the release checklist is #792.

## Add-ons

Add-ons live in their own repositories and talk to StageBoard through the interface in [docs/32](docs/32_Add-on_Schnittstelle.md). Device-specific behaviour belongs in that device's add-on, not in the core.

## Licence

Not decided yet (#787). Contributions are accepted under the licence the project adopts; until then please open an issue before a large contribution.
