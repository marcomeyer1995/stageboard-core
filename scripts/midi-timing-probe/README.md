# MIDI timing probe (#477)

Measures how precisely WebMIDI delivers messages, and whether `MIDIOutput.clear()` exists, in a browser engine.

- `receiver.py` - virtual ALSA MIDI input ("SB Timing Probe") that logs every message with a monotonic arrival time. Needs `python-rtmidi` (the Device Emulators' venvs have it).
- `probe.js` - runs in the page: 48 notes with `send(data, timestamp)` (channel 1), the same sent "now" from a timer (channel 2, baseline), then the `clear()` test (notes 100/101 scheduled and recalled, 102 must arrive).
- `run-chrome.mjs` - starts desktop Chrome headless, grants MIDI over CDP, runs the probe.
- `analyze.py` - jitter per run and the `clear()` result from the receiver log.

Laptop run:

```sh
cd scripts/midi-timing-probe
"$HOME/Device Emulators/BOSS RC500 Emulator/.venv/bin/python3" receiver.py > recv.log &
node run-chrome.mjs
python3 analyze.py recv.log
kill %1
```

Tablet: put the tablet's USB mode on "MIDI" (the laptop then sees it as a MIDI device, the tablet sees the laptop), run `probe.js` in the app's WebView over CDP (`scripts/tablet-debug.mjs`, adb over Wi-Fi since USB is in MIDI mode) with the laptop-side port name, and log on the laptop with a receiver bound to the tablet's port instead of the virtual one.

Result 2026-10-13, Chrome 154 on the laptop: timestamped 0.05 ms jitter (SD), timer-sent 1.2 ms; `clear()` does not exist; messages sharing one timestamp arrive in random order (hence `SEQUENCE_STEP_MS` in webMidiOutput.ts). Details on #477.

## Sync test across devices (docs/21 §4)

Diagnose tab → "Synchron-Test" on every device at once: each full second of server time is marked with a MIDI note (note = second mod 128, one MIDI channel per device) and optionally the real click. On the laptop that runs the Stage-Server (its clock = server time), with the tablets in USB mode "MIDI":

```sh
"$HOME/Device Emulators/BOSS RC500 Emulator/.venv/bin/python3" sync-receiver.py Fire,Redmi --mic > sync.log
python3 sync-analyze.py sync.log
```

Gives each device's offset from server time, the offset between devices for the same second, and (one device clicking at a time) click onsets in the laptop microphone vs. the second - the audio output latency plus a constant capture bias of the laptop.
