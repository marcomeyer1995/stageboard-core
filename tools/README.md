# tools - working with the test devices

Scripts for testing StageBoard on real devices and in a browser. Node 22+ (no build step), adb
for the devices, Python with numpy for `measure/`. Nothing here ships with the app.

| Tool | What for |
|---|---|
| [cdp](cdp/README.md) | evaluate, navigate, screenshot - the app on a device or any CDP port |
| [device](device/README.md) | install an APK, set and read the volume, wake, info |
| [night-test](night-test/README.md) | does the app keep playing with the screen locked (#724, #789) |
| [phone-check](phone-check/README.md) | pages at phone size in a headless Chrome |
| [stage-map-harness](stage-map-harness/README.md) | the real stage map in a browser, no server |
| [measure](measure/README.md) | click/track offset, crosstalk, silence after unplugging (#742) |
| [server/deploy-ref.sh](server/deploy-ref.sh) | run the Stage-Server from another ref for a test, and back |

**Devices:** copy `devices.example.json` to `devices.json` (git-ignored) and fill in the serials
from `adb devices -l`, a free local port per device and how its volume changes. Names in there
are what the tools take (`Redmi`, `Fire`, ...).

**Ground rules** (they come from real mistakes): never type a PIN or a password by script; never
change system settings; read the volume back right before anything plays (at night 0-1); the
release app is not debuggable - use the dev app (`de.stageboard.app.dev`) for `cdp`.

The methods behind them: docs/09 (debug logger, adb ground truth), docs/10 (CDP network capture,
IndexedDB inspection), docs/19 (debug builds, CDP hooks), docs/30 (native output).
