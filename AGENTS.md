# StageBoard – agent rules

Local-first live OS for bands. npm workspaces: `shared-types`, `core-backend` (Fastify, Zod), `stage-pwa` (React, Vite), `sync-host`.

## Always

- Read `CONTRIBUTING.md` before changing code. Repo and tracker language is English.
- Work issue-first: acceptance criteria before code, small commits, draft PRs. Merging: only when the maintainer has said so for that PR (or a named set of PRs), the CI check `build-test` has passed, and the PR is not a stacked one waiting on another; squash-merge, then delete nothing else. Never push to `main`, never deploy.
- Run `npm run verify` (lint + typecheck + tests for every workspace) before claiming anything is done. CI also checks the C++/WASM audio engine (`.github/workflows/ci.yml`).
- Strict TypeScript only. Validate every boundary (HTTP, replication docs, plugin messages) with Zod schemas from `shared-types`.
- For audio, click, timing, clock sync or native-app changes, a passing mock test is not ground truth. If no real device was used, say "needs device verification" in the PR. Never invent measurements.
- Never type PINs/passwords in scripts, change system settings, touch production deploy, or log secrets.

## Docs routing (read only what the task needs)

- Overview, new idea or issue placement: `CLAUDE.md` (doc index) and `docs/00_System_Vision_und_Architektur.md`.
- Developer setup, logs, tests, deploy, AI workflow: `docs/03_Developer_Experience.md`.
- UI, widgets, controls, themes: `docs/15_UI_System.md` and `docs/07_UI_Konzept.md`.
- Song editor, chords, timecode, timeline: `docs/04_Editor_Und_Datenstruktur.md`, `docs/14_Timeline_Editor.md`.
- Add-ons and plugins: `docs/32_Add-on_Schnittstelle.md`.
- Stage map, devices, ports, latency: `docs/31_Buehnenplan.md`.
- Triggers, footswitches, MIDI controllers: `docs/23_Ausloeser_und_Aktionen.md`.
- Audio output, clock, latency, hardware: `docs/29_Synchronitaet.md`, `docs/30_Audio_Ausgabe.md`, `docs/21_Timing_und_Kalibrierung.md`.
- Debugging symptoms: `docs/09` (clock sync), `docs/10` (audio resume), `docs/11` (status latency), `docs/13` (click), `docs/19` (track playback).
- Host tiers and distribution: `docs/25_Betriebsstufen_Host.md`, `docs/33_Distribution_and_Remote_Access.md`.
- Real devices and test rigs: `tools/README.md`.

## Workflow

Load the `stageboard-workflow` skill for code work; `/issue <number>` runs the full loop. Superpowers handles brainstorm → plan → TDD → review → branch finish. Verification is always `npm run verify`; device checks are never skipped silently.
