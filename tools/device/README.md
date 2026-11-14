# device - install, volume, wake, info

```
node tools/device/device.mjs info
node tools/device/device.mjs install path/to/stageboard-dev.apk Redmi Fire
node tools/device/device.mjs volume 1          # all devices, read back (each device has its own scale, see info)
node tools/device/device.mjs wake Redmi
```

**Volume** (media stream) changes differently per device - set `volume` in `devices.json`:

| `volume` | Command | Seen on |
|---|---|---|
| `media` | `media volume --stream 3 --set N` | Amazon Fire (Android 9) |
| `session` | `cmd media_session volume --stream 3 --set N` | Xiaomi phone - it blocks key events unless "USB debugging (security settings)" is on |
| `keys` | volume keys down, then up N times | Redmi Pad - `cmd media_session --set` reports success there and does nothing |

Read the volume back right before playing anything: some devices bring it back up after a
reconnect or an install. At night keep test devices at 0-1.

**Install** keeps the app's data (`adb install -r`). The dev app (`de.stageboard.app.dev`) installs
beside the release app. Xiaomi devices ask for an OK on the screen.

**Wake** only takes the lock screen away when the device has no PIN; never type a PIN by script.
