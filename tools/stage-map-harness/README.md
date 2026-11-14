# stage-map-harness - the real stage map in a browser, no server

```
tools/stage-map-harness/run.sh                          # vite on :5199, Ctrl+C removes the files again
node tools/phone-check/phone-check.mjs start
node tools/cdp/cdp.mjs nav 9400 http://127.0.0.1:5199/stage-map-harness.html
node tools/cdp/cdp.mjs eval 9400 "window.__map.getState().equipment.map((e) => e.name)"
node tools/cdp/cdp.mjs shot 9400 map.png 1280 1100
```

The page renders `StageMap` with three devices and two members, data in the browser's own
PouchDB (survives reloads in that Chrome profile). `?admin=0` opens it as a member.

For scripts the page exposes `window.__st` (shared-types), `window.__map` (the stage map store),
`window.__di` (device info), `window.__pl` (plugins), `window.__op` (output plan). Example: add a
mixer and a cable

```js
const st = window.__st, m = window.__map.getState()
await m.saveEquipment(st.equipmentFrom(st.BUILTIN_MODELS.find((x) => x.id === 'mixer'), 'desk', 'Desk'))
```

Simulated device reports for "Prüfen": `window.__di.setState({ loaded: true, reachable: true,
deviceInfo: { devices: { tablet2: { ...entry, lastSeenAt: Date.now() } } } })` - repeat it every
few hundred ms, the store's own poll (no server) overwrites it.

Used on 2026-11-11 for the pretest of the stage stack (#797-#806); it found four bugs.
