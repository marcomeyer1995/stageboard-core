# test-runner - checks on the real devices, with a report

```
node tools/test-runner/run.mjs                                   # every device in devices.json, every check
node tools/test-runner/run.mjs --devices Fire,Phone --checks gui
node tools/test-runner/run.mjs --checks solo-start --out /tmp/run
```

Step 1 of #819 (automated development: Claude builds and checks, Marco accepts). For each device
it starts the dev app if needed, connects over CDP, injects `page.js` (helpers as
`window.__sbt.*`) and runs the checks. The report lands in `out/<time>/` (git-ignored):
`report.md` (one line per result, screenshots linked), `report.json`, the screenshots. Exit
code 1 when anything failed.

| Check | What it does |
|---|---|
| `app` | the app runs - build, mode, status bar |
| `gui` | Boards, Bibliothek and every System tab on the device's real size: text cut off, content past the right edge or clipped (the status bar counted once), the page scrolling sideways (errors); touch targets and text below the screen's tier - Boards 48/16 px, preparation screens 40/14 px (docs/15) (warnings). A screenshot of each. |
| `solo-start` | Solo, StageBoard Referenz-Song: tap "Takt 35" stopped → 1:13, Play starts there, a tap while playing jumps, a section button from a stop (#817). Opens the song itself by stepping through the catalogue. |

**Devices** are found by their adb `model` when their serial moved (wireless adb ports change on
every restart) - put `model` into `devices.json` (see `devices.example.json`). A device that is
not attached is reported as skipped, not failed.

**Ground rules** (as for all tools): nothing is typed, no system setting is changed; at night
(22-8 h) the media volume is set to 0 before anything plays. A check may change the app's state
(mode, open song, position) - `solo-start` puts the mode back.

Next (#819): screens at phone/tablet sizes in a headless Chrome (`phone-check`), the device-test
blocks of 2026-11-12 as further checks, then a nightly run.
