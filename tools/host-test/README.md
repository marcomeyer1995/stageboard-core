# host-test - a band on tablets alone (#962)

```
NODE_TLS_REJECT_UNAUTHORIZED=0 node tools/host-test/no-laptop.mjs --host https://<tablet>:8443
```

Plays a phone against **one tablet as the only host**: founds a band, lists, renames, reads and rotates the code, syncs
a song through the host's database with real PouchDB, founds a second band (403 without an admin proof, 201 with), blocks a
device, deletes a band, checks it is never founded again, and asks for jobs a tablet does not do yet (501 with the missing
capability, never 404). PASS/FAIL per check, exit 1 on any FAIL. No PIN is typed: it uses the logins the host hands out.

It leaves the bands it founded on the host - run it on a test host. For a host that starts with **no band** use the isolated
test app, which has its own storage next to the dev app:

```
cd packages/stage-pwa/android && ./gradlew assembleDebug -PstageboardVersionCode=<n above the installed one> -PstageboardAppIdSuffix=.dev.test
adb -s <serial> install -r app/build/outputs/apk/debug/app-debug.apk       # package de.stageboard.app.dev.test
STAGEBOARD_DEV_APP=de.stageboard.app.dev.test node tools/cdp/cdp.mjs eval <Device> "localStorage.setItem('stageboard-android-host','on'); location.reload()"
```

(The app's join screen also has "This device as a host" for a person without CDP.) Audio, clock sync and a real second
phone stay "needs device verification".


## session.mjs - one band's whole life against one host, measured

```
NODE_TLS_REJECT_UNAUTHORIZED=0 node tools/host-test/session.mjs --host https://<host>:<port> --label laptop --json out.json
```

The same script for a laptop host and a tablet host, so the two can be compared (#964, 2026-11-21): three clients with real PouchDBs (two tablets, a laptop
browser) found a band, write 200 songs and 8 setlists, sync live (how long a change takes to arrive, p50/p95), edit one song at once (a conflict, nothing
lost), move a 3 MB track up and down, use add-ons the way the app installs them (a `plugins:` document), push show state to a listener, and delete the band.
PASS/FAIL/SKIP per check, every timing printed. It never types a PIN. For a **laptop** host to run the band's jobs and add-ons the band must be the one it
serves, which needs an admin PIN a script never types: found the band with `--found-only creds.json`, restart the host with
`STAGEBOARD_WORKSPACE=<band id>`, then run with `--band <id> --creds creds.json`. A tablet host needs none of that. One laptop plays all three clients, so
their CPU is the laptop's - the numbers compare the **hosts**, not the clients.
