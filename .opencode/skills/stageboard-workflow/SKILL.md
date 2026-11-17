---
name: stageboard-workflow
description: Use when changing code in stageboard-core, implementing a GitHub issue, or verifying a StageBoard fix. Encodes the issue-first TDD loop, the single verification command and the real-device truth rule.
---

# StageBoard workflow

1. **Scope.** Read `CONTRIBUTING.md`, the issue and only the doc(s) from the routing table in `AGENTS.md`. Never load the whole `docs/` tree.
2. **Design.** On an ambiguous issue, invoke Superpowers `brainstorming` and write acceptance criteria before code. Use `using-git-worktrees` for non-trivial work.
3. **TDD.** Invoke `test-driven-development`: failing Vitest test next to the code, then minimal implementation. Validate every boundary with Zod from `shared-types`. Hardware stays behind interfaces with mocks (docs/03 §2).
4. **Verify.** Run `npm run verify` after each task and before any claim of done. Report the command and its result, not a guess. C++/WASM changes also need the engine steps from `.github/workflows/ci.yml` (requires cmake and wasi-sdk).
5. **Device truth.** For playback, click, timing, clock sync or native-app work, use the real-device methods in docs/09, docs/19, docs/24 and docs/30. If no device was available, write "needs device verification" in the PR. Never invent measurements.
6. **Review.** Invoke Superpowers `requesting-code-review` between tasks. Keep commits small: `<area>: <what changed> (#issue)`, English, no secrets, no docs created unless asked.
7. **Finish.** Invoke `finishing-a-development-branch`. Draft PR must list what changed, what was tested (commands and devices), and what is left. Never merge, deploy or push to `main`; the maintainer merges.

## Token discipline

No MCP server is needed in this repo. Use shell/read/grep tools and the scripts in `tools/` directly. Tool output is capped in `opencode.jsonc`; for large logs or screenshots, delegate analysis to a subagent so raw output stays out of the main context.
