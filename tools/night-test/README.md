# night-test - does the app keep playing with the screen locked?

For #724 (foreground service) and #789 (the 6-hour test). Two or more devices on USB, the dev
app on each, `tools/devices.json` filled in (`NIGHT_DEVICES=Fire,Redmi` picks some).

## Steps

1. `node tools/night-test/night.mjs unlock` (devices without a PIN), then in the dev app open
   **Solo Üben** and load a song with track and click (don't play).
2. `node tools/night-test/night.mjs prepare` - DevTools port, counters into the page
   (`install.js`), media volume to 0.
3. `node tools/night-test/night.mjs start` - checks the volume again (no start otherwise),
   Play + loop the section, 8 s to check that clicks run, then locks. The clock starts here.
4. `nohup node tools/night-test/night.mjs run > tools/night-test/out/run.log 2>&1 &` - probes at
   3/6/10/15/20/30/45/60/90/120/180/240/300/360 min.
5. In the morning: `node tools/night-test/night.mjs report` → `out/report.md`.

`node tools/night-test/night.mjs probe` measures once, now, and writes nothing - a quick check
that adb, the port forward and the page all answer. Without `prepare` the page part says
`not installed`, which is fine.

Results stay in `out/` (git-ignored).

## What is measured

| Column | Source | Meaning |
|---|---|---|
| Screen | `dumpsys power` | really locked? |
| App/service | `pidof`, `dumpsys activity services` | app not killed, foreground service active |
| Audio | `dumpsys audio`, or AudioFlinger's track table (Android 9) | the app's output stream runs |
| Timer | a 1 s `setInterval` in the page | how often JS timers really run |
| Clicks | every started oscillator = one scheduled click | missing clicks = gaps in the grid |
| Plugin answer | `NativeOutput.status()`, not awaited | do answers over the app bridge come back? |

## Known so far (2026-11-10, both devices locked for hours, nothing playing)

- Timer: **0 ticks** in 3-8 min - frozen, not just throttled (earlier: once a minute after 3 min).
- Plugin answers hang for more than 5 min, on both devices.
- The output stream keeps running, the foreground service stays active.
- Guess for the night run: Chromium freezes pages that output nothing *audible* - with native
  output the WebView itself is silent. Whether a playing song changes that is what the test shows.
