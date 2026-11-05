# sync-bench: click, track and stems against the song clock (docs/29 §7 level 2, §11)

Measures, on real tablets and without a microphone, where every click and every track beep of
the reference song (#464) is **heard** relative to the song clock - per start and over a whole
song. The before/after comparison of the time base (#690) was made with it.

## How it works
- `capture.js` is injected before the app loads (`Page.addScriptToEvaluateOnNewDocument`). Every
  audio node that connects to the output is also routed into an AudioWorklet that detects onsets
  per source - each onset carries its exact audio-clock frame (`currentFrame`). Every 20 ms it
  logs an output-timestamp pair (`getOutputTimestamp()` + `performance.now()` + `Date.now()`).
  (A ScriptProcessor recorder dropped blocks on the Fire, and its `playbackTime` follows the
  stepping `currentTime` - don't use one.)
- `run.js` presses Stop (fresh) or Pause (resume), then Play, and stores the practice transport.
- `analyze.mjs`: frame -> audio time -> heard `performance.now()` (robust line through the
  output-timestamp pairs of the last 60 s) -> `Date.now()` -> song time (transport) -> distance to
  the nearest reference beat. `OFFSET` (ms) centres the beat matching for a device whose heard
  offset is near half a beat (Fire ~255, Redmi ~35).
- `compare.mjs <set>...`: the table in docs/29 §11.

## Running
Dev app on the tablets (adb), Solo practice, the reference song current, click on, a dashboard
with Play/Pause/Stop. Volume can be 0 - the capture is digital.

    ./full.sh <label>         # both tablets: 3 fresh + 9 resume takes of 8 s, then the whole song
    node compare.mjs before-main after-step1

Device serials and ports are in `full.sh`. Raw data of 2026-11-04: `~/stageboard-data/sync-bench/`.

## Known
- The reference song's in-bar tempo change (bar at ~78 s) and the jump (~102 s) put some clicks
  off the generator's beats - the app grid has points only at bar starts. Medians ignore them.
- The absolute offset includes neither the output's remainder after the timestamp (DAC, speaker)
  nor a latency profile (the dev app has its own device id) - compare spreads and drift, not the
  absolute value.
