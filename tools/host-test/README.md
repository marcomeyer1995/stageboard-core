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
