# Operating tiers: StageBoard without a fixed Stage-Server

Basic idea as of 2026-10-28, discussed with Marco on 2026-10-27/28. Decided and started since 2026-11-07: §6a. Since 2026-11-10 (#784) the three operating tiers replace the old hardware matrix: [docs/02](02_Operating_Tiers.md) was rewritten, and core principle 1 in CLAUDE.md now reads "the host is the heart". Since 2026-11-17: the host backup (a primary and a passive backup) is decided, §6e; since 2026-11-18 as a module of the base package, not an add-on (#949). Translated to English on 2026-11-17 (#785), together with the decisions that until then lived only on the branch `spike/android-host` (§6a measurements, §6c, §6d).

## 1. Why

Today a band needs a Stage-Server (Linux, Docker, CouchDB) for everything that involves more than one device. For many bands that is a hurdle before they even try it: extra hardware, setup, cost. The old docs/02 did promise a "tier 1: zero hardware", but only for a single device - as soon as two musicians want to play together, there was no way around the server.

Goal: **start with what the band already has** (tablets, phones, a laptop), and move to a dedicated box only later. That widens the possible user base and lowers the entry hurdle.

## 2. Basic idea: the Stage-Server becomes a role

Instead of "one particular computer", the Stage-Server is a **role ("host")** that any capable device can take on. The host reports what it can do (sync, clock, push, tracks, plugins); the app shows what is missing on this tier - the same graceful degradation as with missing hardware today.

The precondition is already there: every device holds a complete local copy of the band (PouchDB). Moving to a higher tier is therefore not an export/import - the data simply replicate to the new host.

## 3. What the host does today

| Task | Needed for a gig? |
|---|---|
| Sync hub between the devices (CouchDB, `/db` proxy) | yes |
| Clock reference for clock sync (`/time`) | yes |
| Fast push of show state, switches, flashes (SSE) | yes |
| Store and distribute backing tracks (`/audio`) | yes |
| HTTPS (secure context, the app's certificate pinning) | yes for browsers |
| UDP: OSC, mDNS discovery | only with OSC/light |
| Heavy add-ons: Demucs, Piper, UG/YouTube import, backup, app updates, microphone calibration | no |

A minimal host needs only the first four rows.

## 4. Three tiers

| Tier | Setup | What works |
|---|---|---|
| **1 Solo** | one device, no host | Everything for one person: Solo Üben, prompter, track, click, announcements, MIDI on the device. **Works today** (home sandbox). |
| **2 Band host** | one of the band's devices is also the host (laptop, Windows tablet, later Android) | Several devices in sync: shared show, master, clock, flashes, tracks distributed, post-gig report. Network: Wi-Fi at the venue or the host's hotspot. Without the heavy add-ons. |
| **3 Stage-Server** | a dedicated box (as today) | Everything, plus the heavy add-ons and a backup host (§6e, #782). |

What a function really needs (host tier, gear at the spot, helper program) is listed per function in docs/02 §2.

## 5. Platforms

| | As a player (client) | As host |
|---|---|---|
| **Windows / Mac** (laptop, Surface) | very good: Chrome/Edge with WebMIDI | **very good**: the existing server runs natively on Node; needs an installer instead of Linux/Docker |
| **Android** | very good (own app) | **possible, spike done (§6a)**: a small native web server in the app plus `sync-host` over the app's database; foreground service against Android ending it; hotspot |
| **iPad** | **limited**: Safari has no WebMIDI (no pedals/MIDI cues), stricter audio rules, storage can be cleared; really good only with an own iOS app | **hardly**: no Node, a server at most while the app is in the foreground, own iOS app needed (Mac, Apple account) |

## 6. Technical building blocks

1. **CouchDB becomes optional.** PouchDB in Node can serve the replication protocol too (no Docker). The full server then runs on Windows/Mac as a normal program, with the same code, and is the basis for an Android host. The Stage-Server may stay on CouchDB.
2. **The host reports its capabilities**; the app shows missing add-ons instead of errors.
3. **Certificates per host**: the Android app pins the certificate of the one Stage-Server today; with a changing host the trust has to come from somewhere else - decided in §6d (fingerprints in the band data).
4. **Network without a router**: the host device's hotspot; discovery via mDNS.

## 6a. Decisions and state (Marco, 2026-11-07)

| Question | Decision |
|---|---|
| Order | first merge and roll out all open PRs (done: main e78f86b, app 1.580), then **server without CouchDB**, then **spike Android as host on the Redmi** |
| How without CouchDB | **an own small module** `packages/sync-host` in plain TypeScript over PouchDB - not express-pouchdb (unmaintained since 2019, PouchDB 7) and not Node on Android (nodejs-mobile is at Node 18, the Fastify 5 server needs ≥ 20). The same module runs on the laptop (Fastify) and in the Android app (native web server → module in the app over the PouchDB it already has) |
| Accounts on an Android host (2026-11-07) | **C: accounts in the band data** - every device has them, every device can become host, also after a failure. Condition: only keys of **long device passwords** go there (like the tablets' random 24-byte logins), **never PIN keys** - 4-digit PINs could be guessed offline in seconds. Admin accounts with a PIN get an additional device key for this. Details §6c |
| Wi-Fi in the gig (2026-11-07) | **lock against power saving in gig mode on all tablets** (#716): measured, a Play arrived up to 125 ms late after pauses; with the lock phone median 85-116 → 46 ms, Redmi p90 155 → 67 ms, Fire (Android 9) little change |
| Server plugins on the map | Download tool, stems, Piper etc. appear at the host on the stage map and can be installed there **where the host can run them** (Linux/Windows yes, Android no, grey "does not run on this host"). The host reports that (`GET /server/capabilities`). **Added 2026-11-10 (docs/32):** the rule applies **per add-on**, not per platform - an add-on runs on a host when its JS part runs there and the helper program it needs for that platform is present (YouTube on Android: yes, §6b; stems on Android: no, as long as there is no Android helper). On the map: #769 |

**Built (branch `feat/sync-host`, merged):**
- `sync-host`: the replication protocol (info, changes feed also long-poll, `_revs_diff`, `_bulk_docs`, `_bulk_get`, `_all_docs`, checkpoints, documents, attachments) and on top of it a **small CouchDB** - server admin, accounts only as PBKDF2 keys (WebCrypto), `_session`, `_security` (CouchDB 3 rules), the band's `validate_doc_update` functions on every write (replication too), band list, create/delete databases. Tested with real PouchDB replication over HTTP and with the **unchanged** `couch.ts`.
- Stage-Server: the built-in host starts in-process (since #960 always; `STAGEBOARD_DB=builtin` used to switch it on), data as LevelDB files (`STAGEBOARD_DB_DIR`, otherwise `<STAGEBOARD_STATE_DIR>/database`), listens where CouchDB would (127.0.0.1:5984, `STAGEBOARD_DB_PORT`) - `couch.ts`, the `/db` proxy and the command-line tools stay unchanged. Without the switch: CouchDB as before.
- **Accounts per C** (2026-11-08): the Stage-Server puts the keys of all device logins of a band (CouchDB PBKDF2, never the PIN anchors) into the band document `host-accounts`; only it may write it (roster validator: `_admin`). It follows `_users`, so every pairing, role change, removal and command-line tool arrives there. Trial on the copy: SOAT 5, Abadschendaler 49 device logins, no PIN account. Signing in anew as admin stays with the Stage-Server (Marco: agreed).
- `GET /server/capabilities`: platform, database, per server plugin "runs here" or what is missing (demucs, piper, chrome, yt-dlp).

**Trial with real data (2026-11-07):** the real CouchDB (3.5.2) copied read-only into a test server in built-in mode - accounts 69/69, SOAT 16/16, Abadschendaler 9,748/9,748 documents in 4 s. CouchDB stores passwords with 600,000 PBKDF2 rounds (same format) - checked sign-ins are therefore remembered for 5 min. With a test member only in the copy: a fresh tablet pulls the band in 4.2 s over `/db`, a live change 46-62 ms, a member's profile change rejected.

**Device test passed (2026-11-07, Marco at home):** test server with `STAGEBOARD_DB=builtin` over HTTPS on a refreshed copy of the real database, the dev app on the Redmi switched to it: Play, library (song edited), stage map, Diagnose, Stage-Server tab, add-ons, sync - all as usual; the test changes stayed in the copy.

**Spike Android as host (branch `spike/android-host`, 2026-11-07/08):** a native web server in the dev app (`LocalHostPlugin.java`, Java ServerSocket, one thread per connection) answers `/time` itself and passes everything else to `sync-host` in the app over the band database it already has. Measured from the laptop over the home Wi-Fi, Redmi as host:

| | Redmi | Laptop (for comparison) |
|---|---|---|
| fresh tablet pulls the whole band (9,748 docs) | **52.7 s** | 4.2 s |
| live change A → host → B | **121 ms** median, max 186 | 46-62 ms |
| `/time` round trip | **16 ms** median, p95 35 ms | - |
| spread of the clock offset | **3.2 ms** | ±4 ms (docs/29) |

- Keeping connections open (keep-alive) and JSON as text instead of Base64 through the bridge: full sync 52.7 → 42 s, live 121 → 92 ms; larger batches (500/1000) 35 s.
- Measured *inside* the app: the time goes into the WebView's own database (IndexedDB) - changes 137 ms per 100, fetching documents 123 ms per 100; bridge and network only 25-50 ms per request.
- **Live channels native:** the Play signal and switches (show-state/switch-state: push → stream, SSE) are forwarded by the Java server itself, without the WebView - median 10-13 ms. After pauses ≥ 1 s up to 125 ms: the Redmi's **Wi-Fi power saving**. With a **Wi-Fi lock in low-latency mode** (an app lock, no setting) while hosting: 1 s pause 11.5 ms median / max 19 ms, 3 s pause 12 / max 23 ms. The same lock in gig mode on every tablet became #716.
- **Re-measured 2026-11-08, after cleaning up the band:** 97 % of the band were show-log entries, 8,127 of them noise (all capabilities flipped together on a shaky heartbeat, fixed in #717). At Marco's request all post-gig reports were removed on the server (purge, backup under `~/stageboard-data/manual-backups/`): 9,808 → 324 documents. Over the Redmi as host: **a fresh tablet pulls the band in 3.3 s** (batches of 100) or **2.7 s** (500) instead of 52.7 s; live change A → host → B 105-110 ms median (through the WebView database; the Play signal runs natively, 10-13 ms). The first sync is no obstacle any more - as long as the show log does not grow again (loading show history on demand: Marco "not now").
- **Accounts per C in the Android host (2026-11-08):** the host checks sign-ins against the band document `host-accounts` (#718, written by the Stage-Server) - `createHostLogin` in `sync-host` (PBKDF2 like CouchDB, old SHA-1 accounts too, remembered 5 min). The live channels ask the app the first time and remember the answer in the Java server. On the Redmi with a local test database (600,000 rounds): first sign-in 220-300 ms, then 23 ms; wrong password, a device of another band, no login: 401; live change 110 ms median; Play channel with login 9 ms median, max 14 ms. With the real band after #718 was rolled out: Redmi as host, the laptop with the Fire's real login - band 200, wrong password 401, other band 401, whole band (325 docs) in 2.5 s.
- **The band's write rules in the Android host (2026-11-08):** `createWriteGuard` in `sync-host` - the same check couch-host already had, now for both hosts: every write (document, delete, attachment, replication via `_bulk_docs`) goes through the band's `validate_doc_update` functions. Closed on the way: **attachments** used to bypass the rules in both hosts. Checked on the Redmi with the real rule: a member syncs a lineup change and a song → song written, lineup rejected; a member changes/deletes the lineup 403; writing `host-accounts` as member and admin 403; replacing the rules 401; admin changes the lineup 201.

Result: **feasible.** Clock good (native), live sync sufficient, the first full sync fast enough after the cleanup. The spike branch is not merged; its state is the starting point for #781.

**Still open:** a real run on the laptop with a fresh band and several tablets (#778); moving an existing band off CouchDB (#779); the plugins on the map in the app; Android as host as a real tier (#781: hotspot, foreground service, battery and load).

## 6b. YouTube download on every host (Marco, 2026-11-10)

| Question | Decision |
|---|---|
| Where | **on every host** - also an Android device as host, and without a host (Solo) on the device itself. Different from "server plugins on the map: Android no" (§6a) for this plugin |
| How delivered | **not in the app**: an own plugin that everyone installs themselves and is responsible for themselves (legal question from docs/16 §A.2 "separate risky functions" and the licence of the YouTube code). Only for private development purposes |
| Format | everything as **Ogg Opus** (docs/30 §8h): YouTube's Opus stream is repackaged losslessly, everything else converted - "always, in any case", not depending on what is installed on the host |

**Implementation (proposal):** on Android an **own small plugin app** (its own package next to `de.stageboard.app`, a bound service: search, load the Opus stream with progress); the StageBoard app detects it, without it it is only missing on the map. Inside it **NewPipeExtractor** (Java, GPL-3) - only in the plugin app, never in the StageBoard APK. Repackaging/converting in the app (`webmOpusToOgg`, Opus encoder as WASM), so the same on every host. Laptop/PC host still with `yt-dlp`.

**Feasibility checked (2026-11-10, laptop, NewPipeExtractor v0.26.5 in JDK 21):** for one video in 2.6 s all audio streams (M4A 139/140, Opus 249/250/**251 at 160 kbit/s**), Opus 251 loaded (10.2 MB in 2.6 s, in 10 MB ranges) - **byte-identical** to the file from `yt-dlp -f 251`; repackaged to Ogg valid, same length in OpusClip and ffmpeg. Search (#618): 10 hits in 2.5 s with ID, title, channel, duration. Libraries together 3.6 MB (Rhino 1.3, Protobuf-Lite 1.0, Extractor 0.8, Jsoup 0.5). Open: on the device (Android HTTP instead of the JDK client), how long a version holds until YouTube breaks it (plugin updates).

## 6c. Accounts on an Android host - decided: C (Marco, 2026-11-07)

The accounts (name, roles, PIN only as a PBKDF2 key) used to live **only on the Stage-Server** (`_users`, only the server admin reads them). A tablet knows only its own login, so a tablet as host could not check the others. The options:

| | How | For | Against |
|---|---|---|---|
| **A Pair per host** | Whoever joins an Android host pairs by QR code as with the Stage-Server today; the host issues its own logins | safe, no new secrets on the devices | every device pairs again when the host changes |
| **B Move from the server** | While the old Stage-Server is reachable, it hands the band's accounts to the new host (admin action) | no re-pairing | only works with the old server; no way out when it fails |
| **C Accounts in the band data** | The keys lie in a band document, every device has them, every device can become host | host change any time, also after a failure | every device would hold all PIN keys - 4-digit PINs guessed offline in seconds; acceptable only with long device keys instead of PINs |

**Decided: C** - every device can become host, also when the current one fails in the middle of a gig. Condition: the band document holds only keys of **long device passwords** (most tablet logins already are random 24-byte passwords), **never PIN keys**. Admin accounts that sign in with a PIN get an additional device key; the PIN stays on the Stage-Server only. (The earlier proposal was A + B.) Built: §6a "Accounts per C".

**Still open for the Android host:** hotspot (Android allows an app its own "local-only" hotspot without internet, with a random name/password - but it often drops the normal Wi-Fi, so not tested remotely), foreground service (host keeps going with a locked screen, the same building block as N1, #724).

## 6d. Finding and trusting a tablet server - decisions (Marco, 2026-11-08/10)

Term: "host" = the device that is **the band's server** right now - the laptop (Stage-Server) or a tablet. There is always only one.

| Question | Decision |
|---|---|
| Who can become server | The **admin enables it per tablet** (map/devices). Only enabled tablets create a certificate and offer themselves |
| Who is it right now | *Decided 2026-11-08:* an admin-defined **order of server devices**, everyone uses the first reachable one. **Replaced 2026-11-17 by §6e:** a primary and one passive backup, in the host-backup add-on; the data model stays open for a longer list later |
| Back to the better one (2026-11-10) | only **between songs** (pause/stop/after the song) - a switch briefly costs the Play channel and the clock. Kept in §6e |
| Never two servers (2026-11-10) | a device further down only becomes server when it reaches no higher one itself, and hands back as soon as it sees one. A short disagreement loses no data (everything merges). In §6e made exact with an epoch counter |

**Building blocks (proposal):**
1. **Certificate per server tablet:** created once, the key in the Android keystore; the tablet server speaks HTTPS like the Stage-Server. (On the spike branch.)
2. **Trust via the band data:** the tablet enters its fingerprint in `hosts:<device>` - only it may do that (rule: the device login ends in `~<device>`). All tablets know the possible servers beforehand, no QR code in the rehearsal room. (On the spike branch.)
3. **Roles:** a band document (admins only) names the primary and the backup (§6e); the Stage-Server is an entry in it.
4. **Finding:** mDNS as today (`_stageboard._tcp`), plus band, role and epoch; shown in the status bar.
5. **Signing in:** the existing device sign-in (accounts per C).

## 6e. Host backup: a primary and a passive backup (Marco, 2026-11-17, #782)

Every device has the data and the accounts (§6c); clock sync and push, however, hang on the host. When the host fails, the band needs a defined way on.

### Decisions

| Question | Decision |
|---|---|
| Where it lives | **Changed 2026-11-18 (Marco, #949):** not a runtime add-on but a **module in the base package** (`sync-host`), **switchable by configuration** - on a laptop host it always runs, in the app behind "Start host". Reason: it is a fundamental function of the app, and the clean interface (network, storage, time) is what makes it modular, not an add-on mechanism. *Before:* a dedicated add-on, not installed by default. Without a backup the band has none; a host failure then leads to the no-host mode (below), which is part of the core |
| How many devices | **Two**: the **primary** (priority 1) and **one backup**. The data model stays open for a longer chain later (a list with priorities, today at most two entries) |
| Roles | The primary is **active**; the backup is **passive**: it replicates continuously from the primary as a full copy and follows its clock like any device, but serves nothing |
| Alive signal | The primary sends the backup an **alive signal** - every 1 s, as a lease ("I am the host until now + X") |
| Automatic reconfiguration | The backup takes over on **either of two triggers**: (1) the alive signal has been **missing for 5-8 s** (the lease ran out); (2) the primary **asks it to take over** ("take over, I am not in a good state"). **This may happen during a song** |
| Switching back | **Never during a song** - only **between songs** (stop, pause, after the song), and only when the primary (priority 1) is **healthy again** (its alive signal steady for a while) |
| Never two hosts | Every takeover raises an **epoch counter** that the host's announcements carry. Every device follows the host with the **highest epoch**; a primary that comes back with a lower epoch sees it is out of date and stays passive until the handback |
| Split network | **Start simple:** the backup takes over only when it sees the primary **nowhere** - no alive signal, not via mDNS, a direct request fails. Improve later (e.g. devices report which host they reach, and the backup takes over only if they agree) |
| Timeout | **5-8 s** of silence - rather slow than nervous: Wi-Fi hiccups of 1-3 s are normal (docs/09, docs/11), and a running song needs no host (every device plays on by itself). The fast path is the explicit request |

### How it works (plan)

1. **Time base without a jump:** the backup follows the primary's clock like any device. On takeover it serves band time as its own clock plus its last offset to the primary - no device's clock jumps (docs/29). After a handback the primary does the same in reverse.
2. **Data and show state:** already on every device; the backup has the latest because it replicates continuously. Play, the current song and the master stay as they were.
3. **Reasons for the primary to ask for a takeover** (first list, to be refined): battery low and not charging; too hot or overloaded; its database or sync broken; **planned shutdown** (the laptop is closed at the end of the gig) - which gives a clean handover for free.
4. **By hand:** the admin can press "Take over now" on the backup and "Hand back now" (handback also only between songs) - e.g. to test the backup at soundcheck.
5. **Display:** the status bar shows a takeover briefly ("host is now <device>") and red while there is no host; the stage map shows which device is the host right now (#747).
6. **What a takeover cannot move:** gear plugged into the primary (MIDI, DMX on the laptop). The backup can take that over only with its own path - that is #753 (failover only to defined fallback paths); the map shows what is lost and what has a fallback.
7. **A fresh backup learns the band by itself (#945):** the admin names the primary and the backup on the stage map, and nothing else - no shell on the backup, no band code to type. The primary sees the new entry in the band's host list, asks whether that host already serves a band, and only if it serves none hands it the band, the code, its own address and certificate fingerprint. The backup checks the code with the primary (its roster route) before it accepts; a host that serves a band - this one or another - is never taken over. The code is not a secret among the band's hosts: both already hold the band's database, including `workspace:access`. The page itself never talks to the unknown host for this: it asks its own Stage-Server (`GET /host/look-up`), which also keeps the certificate question - CORS in a browser, pinning in the app - in one place.

### No host at all (core, without a backup)

When the host is gone and no backup takes over (none is set up, or the backup is gone too):
- the running song plays to its end on every device, from its own data, the clock free-running on its last offset;
- the status bar turns red: "host gone";
- joining a new device reports "no host";
- add-on jobs on the host (downloads, stems, …) wait;
- the next song needs a host to start on all devices together; until then each device can play only for itself (Solo Üben). *Open:* whether the master device may start the next song for everyone without a host.

### Dependencies and order

- A **tablet as backup** needs the Android host (#781). Two laptops, or the Stage-Server plus a laptop, can work earlier, after #778.
- Steps (issues to be created from #782):
  1. **No-host mode** (core): song to the end, red status, joining reports "no host". Meets the acceptance test of #782 on its own.
  2. **Add-on "Host backup", part 1:** roles in the band document, the backup as a passive full copy, alive signal as a lease, epoch counter, takeover on silence (5-8 s).
  3. **Part 2:** takeover on request (the reasons above), the hand buttons.
  4. **Part 3:** handback between songs when the primary is healthy.
  5. **Display:** status bar and map (#747).
- **Acceptance:** unplug the primary during a running song: the song runs to the end on all devices, the clock drifts measurably little, the backup takes over within 5-8 s, and after the song (primary back) the primary takes over again; without the add-on, joining reports "no host".

## 6f. Measured: every device as host (2026-11-17, #778)

A second server on the laptop with the built-in database (port 8443, a fresh test band), four devices (Fire, Redmi, Xiaomi phone, a Windows PC in Chrome), and the same measurements against every host. Two levels:

**With the full app** (Linux hosts only - the Android host does not serve the whole app yet, see below). Play latency = Play pressed on the master (Fire) until each device shows the count-in, in server time, 10 Plays:

| | Fire (master) | Redmi | Phone | Windows PC |
|---|---|---|---|---|
| Linux, CouchDB (real band) | 120 ms | 78 ms | 51 ms | - |
| Linux, built-in (test band) | 88 ms | 64 ms | 55 ms | 43 ms |

The followers show Play within about ±15 ms of the master's own screen - the push adds little, most of the time is each device drawing. Clock uncertainty 0.3-1.2 ms on all devices (the PC's own clock was 10.7 s off - measured out without trouble). The Rig-Check test song (36 s track) reached all four devices 73 s after "Vorbereiten", including the conversion on the Fire.

**Scripted client on another machine** (`hostbench`: 50 × `/time`, 20 events on the live channel, 10 live changes A → host → B, 3 first full syncs into an empty copy), the same against every host; load = the host's CPU idle → under the bench (Android and Windows: whole device or process over all cores; Linux converted to all 16 threads):

| Host | `/time` round trip | Live channel (Play signal) | Live change | First full sync (~190 docs) | Load idle → bench | Memory |
|---|---|---|---|---|---|---|
| **Linux, built-in** | 5.0 ms | **18 ms** (p95 44) | **54 ms** | **120 ms** | ~0 → 0.6 % | 182 MB |
| **Windows** (i5-5200U from 2015), built-in | 5.7 ms | 22 ms (p95 28) | 69 ms | 162 ms | 0.2 → 2.3 % | 100-120 MB |
| Linux, CouchDB (real band, **7,087** docs) | 5.2 ms | 21 ms (p95 80) | 96 ms (p95 734) | 3.3 s | 0.1 → 2.4 % | 400 MB |
| **Redmi** (Android host, spike) | 7.3 ms | 38 ms (p95 63) | 139 ms | 437 ms | 16.3 → 21.9 % (no host: 15.9 %) | device |
| **Xiaomi phone** | 10.3 ms | 41 ms (p95 68) | 136 ms | 480 ms | 16.4 → 22.0 % (no host: 16.0 %) | device |
| **Fire** (Android 9) | 14.9 ms | 33 ms (**p95 100**) | 149 ms (**p95 338**) | 559 ms | 9.5 → 15.7 % (no host: 9.1 %) | device |

**Result:**
- **Every device can be host**, the clock is precise everywhere (spread 1-2.3 ms) - the tiers are flexible.
- **Desktop hosts lead clearly**, even a ten-year-old Windows laptop: Play signal ~20 ms, live change 55-70 ms. The built-in database is at least as fast as CouchDB with less than half the memory.
- **Android hosts are usable but slower:** Play signal ~35-40 ms, live change ~140 ms - the WebView's database is the bottleneck, as in the spike; the Fire has the worst outliers.
- **Hosting costs the device little:** Android +0.4 % idle and about +6 % CPU under sync; desktops practically nothing.

**Not covered:** the Android host serves only the clock, sync and the Play/switch channels - not the ~70 other routes the app uses (audio, presence, device info, master heartbeat, join, …), and the app can't be pointed at it yet (discovery, certificate) - that is #781. No battery figures (devices on USB). The hour-long gig runs in a night test.

**Findings** (issues): the invite QR code drops the port (#896); after a server switch the sync status still shows ✓ for the old band (#897); the admin PIN is shown in clear in "Band wechseln" (#898); a band move by replication must copy `_security` too (#779); on Windows the execution policy blocks `npm.ps1` and a "Public" network needs the firewall rule for all profiles (#780); the Android host reads request bodies without a length (chunked) as empty, so Play/switch events arrive empty (#781).

## 6g. Android host as the backup - the tablet steps in (#947, 2026-11-18)

The tablet is a full band host, as the **backup** (#947 step 1) and as the **primary** (step 2). First step was the cheapest real test of the host backup (#782 Teil B): the laptop stays the primary, the tablet is the backup. The tablet already holds the band as a device - data, audio, logins - so nothing has to be provisioned for it.

**What the app starts.** A switch (System → Stage-Server → "Tablet als Host") starts `LocalHostPlugin.java`: a small HTTPS server inside the app, certificate in the Android keystore, fingerprint stable across restarts. It answers `/time` (time, `hostId`, `epoch`, `active`), `/server-info` and the live channels (`show-state`, `switch-state`) itself; everything else goes to the app, which answers over its own PouchDB through `sync-host` - the same code the laptop host uses.

**Passive first.** Until it has taken over, the tablet answers only `/time` (`active:false`), `/server-info`, `/server/active-workspace` (`null` - it serves no band), `/host/lease` and `/server/host-lease`. No `/db`, no live channel; a device that asks is refused. So "the band is served by exactly one host" is true on the wire, not just in the app.

**How it becomes host.** The band's host list names the tablet as priority 2 and the laptop as priority 1. The laptop sends its signed lease every second (`hostLeaseAuth.ts`); the tablet verifies it with WebCrypto against the band's key - `HMAC(sha256, 'stageboard-host-lease', workspaceId \n accessCode)`. The code reaches the tablet from the primary itself: because the tablet serves no band, the primary's invite (#945) keeps arriving, the tablet checks the target id and the `sentAt` guard, has the primary confirm the code (`POST /workspaces/:id/roster`) and stores it. Nothing is typed.

After **5 s without a lease** and a **failed direct `/time`** to the primary, the tablet raises the epoch above the last lease and serves the band: `/db` with the write rules (`_design/roster`), live channels, band time = own clock plus the offset it sampled while passive (so no device's clock jumps). A returned primary raises the epoch again (#935); the tablet sees an accepted lease with a higher epoch and steps back to passive. The lease/takeover rules are, for now, a second implementation of core-backend's (`host/hostState.ts`, `host/leaseKeeper.ts`); folding both into one host module is #932.

**The tablet as the primary (#947 step 2).** Listed with priority 1 it serves the band at once (`active:true`, `/db`, live channels) and does what the Stage-Server primary does, from the same state machine (`host/hostState.ts`): it sends its signed lease every second; hands a login to the backup that copies its database (`POST /host/replication-account`, only while it is host); confirms the band code (`POST /workspaces/:id/roster`); and invites a listed backup that serves no band yet (`/host/join-band-invite`, every 5 s - the admin only names the hosts on the stage map). If the backup took over while the tablet was away, the lease reply carries a higher epoch: the tablet is **out of date**, stops serving, copies the backup's data (`host/catchUp.ts`, live PouchDB pull with a login the backup issues) and takes the host role back - above the backup's epoch - after 30 s of steady answers, a current and quiet copy and **no song running** (`show-state`); if that cannot be read it does not guess.

**Measured as primary (2026-11-18, Redmi primary, a fresh laptop host E as backup, home Wi-Fi, no song):**
- E was named backup on the map: the tablet invited it, E joined the band and copied 24 docs (`caught-up`) with no code typed; it heard the tablet's lease (clock offset -103 ms).
- Tablet app stopped: E took over after **~5.3 s** (epoch 20). Tablet back: it came back passive (never two hosts), copied from E and took the role back after ~40 s (epoch 21), E passive again.
- Second round: a document written on E while the tablet was away was on the tablet after the handback (epoch 23).
- Not covered above: audio (done next, see below), battery.

**Gig-like test (2026-11-18, #947): two followers, a playing song, the primary dies.** Tablet (Redmi) primary, laptop host E backup, Fire and Phone as ordinary devices on the tablet, Fire master, test band `leasetest`, home Wi-Fi, apps kept in front (a backgrounded WebView is throttled: the Phone's requests timed out until it was brought forward):
- Tablet app stopped **in the middle of a song**: E took over after **5.6 s** (epoch 28). **Phone followed at +5.0 s, Fire at +5.4 s** (within the poll step of the takeover). The song ran on without a gap - Fire 0:09 → 0:18 → 0:28, Phone 0:17 → 0:31, each matching the elapsed time; no restart, no stop. Clock after the switch: Fire ±1.3-1.7 ms, Phone ±1.0 ms uncertainty (rtt 18 / 10 ms). The Phone showed "no master / 0:00" for ~0.2 s while its show store re-initialised.
- Tablet back **during** the song: it came back passive and out of date and did **not** take the role back for as long as the song played (checked over 90 s).
- Song stopped by the master (now on E): the tablet took the role back **3.1 s** later (epoch 27; 30 s steady, copy current), E passive after 4.2 s, **Phone +5.0 s and Fire +5.3 s** back on the tablet. Second round: restart → handback after ~35 s, all three devices on the tablet at epoch 29.
- Not measured: audio output of a real track (the test songs have none), sample-accurate drift between devices (the screen shows whole seconds), battery.

**Found with real devices and fixed** (none showed in curl or in unit tests):
1. **CORS.** The app's WebView (origin `https://localhost`) needs `Access-Control-Allow-*` on every answer and the preflight; PouchDB fetches with `credentials: 'include'`, so `Allow-Credentials` too. The tablet answers the app and the band's other hosts, nobody else.
2. **Live-channel login.** `EventSource` cannot send a login; the Stage-Server's `show-state/stream` is open and only the `push` is checked. The tablet did it the other way round (copied from the spike) - no device ever received the Play.
3. **Master confirmation.** A device is master only if the host's presence stream shows its heartbeat (`master-heartbeat`, `presence/report`, `presence/stream`). Without it nobody can press Play on a tablet host. Ported (`host/presence.ts`), the native server keeps the latest snapshot for new streams.
4. **Live streams did not follow a host switch** (not tablet-specific): sync and clock follow (#900), but presence, show-state push, switches, plugin health, device triggers and discovery open an `EventSource` once per band and kept retrying the dead host - after a takeover the master was never confirmed again. They now restart when the server address changes (`useWorkspaceResource(..., restartKey)`). `useOscInput` still binds once.
5. **Replication login for the returned primary** and **band code check** (earlier in this section) were missing routes, too.

**Audio on the tablet host (#781, 2026-11-18).** `GET/PUT/DELETE /audio/:variantId/:trackId` over the app's own audio cache (`host/localHost.ts` `hostAudio`; a file stored under a revision is found by variant and track, the newest wins; an upload is kept under the plain key until the band's track list names a revision). Same id rule and same trust (open on the LAN) as the Stage-Server; a passive backup answers 503. Measured with a 20 s stereo WAV (3.5 MB): PUT 3.0 s, GET 1.4 s from the laptop, 1.8 s Fire, 1.5 s Phone, byte-identical (SHA-256); the backup host E **mirrored the track from the tablet on its own** (audio 1 of 2 present - the second was not uploaded), so it has the audio when it takes over. Bytes cross the bridge as Base64 (~2.4 MB/s) - fine for syncing before a gig, slow for a 50 MB track (~20 s); a native file store would be the next step if that matters. Not measured: playing a real track from the tablet host, the tablet's own audio sync mode (#932: forced "full" on a host).

**Screen locked (2026-11-18, measured, not solved).** The app keeps the screen on while it is open (`useWakeLock`, `FLAG_KEEP_SCREEN_ON`) - a tablet host in front is fine. With the screen switched off by hand the page is `hidden`, Chromium throttles its timers, and the lease (sent from a JS timer) stops coming: backup E saw gaps of **8.8 s** (60 s test, old build) and up to **47 s** (90 s test, with the foreground service on while hosting). The **native server kept answering** (`/time` 90 of 90, avg 144 ms, max 640 ms), so the backup's direct probe usually still succeeded and it stayed passive - **but not always: during the 90 s test E took over once (epoch 34)**, the tablet noticed on its next lease (higher epoch → out of date) and took the role back after waking (epoch 35). So a locked tablet is a degraded host that can cost a spurious takeover, never two hosts. A *backup* tablet in that state would also notice a missing lease late. The foreground service (now also on while the host switch is on, so Android does not kill the process) does not change the throttling. The way out is to move the lease loop and the takeover check into the native server (the key, the epoch and the pinned certificate are all known there) - not done; until then: **keep the host tablet awake and in front**.

**Still open:** the other routes the app calls on its host answer 404 on the tablet (`device-info/report`, flash, ready check, plugins) - #781. The tablet's own app talks to its own server (works, but is a loop); #932.


**Limits.** Not the other ~70 routes (audio, presence, plugins, join) - #781. No foreground service, so the screen must stay on / the app in front; no hotspot. The switch is off by default and only in the native app.

**One host module (#949, 2026-11-18, Marco: "the code on Android, Windows and Linux shares as much as possible; the app itself becomes the host").** The lease/takeover/handback/invitation logic, the lease keeper, the host clock, presence and the catch-up copy now live **once**, in `sync-host` (no Node API, no DOM - WebCrypto and plain objects). The laptop's Stage-Server (`core-backend`) and the tablet's app both use `createHostLeaseService`; what stays platform-specific is only the transport (Node's pinned https on the laptop, `fetch` plus the app's certificate pinning on the tablet), where the role is stored (a file / the app's storage) and where the band's hosts and code are read from. The tablet adds one rule of its own (`host/tabletHost.ts`): it serves only when the band's list names it. The laptop's 53 service tests are the specification and run against the shared code. Verified on devices after the switch: tablet primary + laptop backup, song running, primary killed: takeover 5.6 s, followers +6.4 / +7.2 s, song without a gap; handback ~36 s after the restart and the stop. **One route table (#955, 2026-11-18).** The routes every host answers the same way - `/time`, `/server/active-workspace`, `/server/host-lease`, `/host/lease`, `/host/join-band-invite`, `/host/replication-account`, audio (GET/PUT/DELETE) and the presence/master-heartbeat posts - are one table in `sync-host` (`createHostRoutes`). The laptop registers each entry with Fastify (`registerHostRoutes`; the table's `pattern` is Fastify's own notation), the tablet matches an incoming path against it (`matchHostRoute`). What differs comes in as a dependency: where audio lives, how presence is kept, whether the host serves the band (`serving`: the tablet refuses audio and presence with 503 while it is a passive backup, the Stage-Server stays open as before), extra fields for `/server/host-lease`. Two answers were made the same on the way: `/server/active-workspace` names the band a host is set up for **also while it is a passive backup** (the tablet had said `null`, so a primary would have invited it again every 5 s), and the lease answer reports the role (`isActive`). Not in the table yet: the live streams (Fastify's raw reply / the native server), the database proxy and its logins, `/server-info` and the roster. Verified on devices (tablet primary, laptop backup, song running, primary killed: takeover 5.7 s, followers +8.3 / +8.9 s - the follower polls every 5 s -, no gap in the song; handback after the stop, epoch 43).

**One store of tracks (#954, #956, 2026-11-19; Marco: "should we not switch the storage of the tablets in general, to have common code again").** Not a second store for the host: the audio a tablet host serves is **its own playback cache**. Two parts. (1) *Shared rule:* `sync-host`'s `trackSync` holds the key form (`variant:track@rev`, `trackKey`/`parseTrackKey`), the tracks a band's song-variant documents list (`tracksOfVariantDocs`) and the plan (`planTrackSync`: fetch what is wanted and not held in that revision, evict what is held and not wanted - when asked). The laptop's audio mirror (only adds) and the app's audio manager (evicts per sync mode) both use it; the app's key format and storage interface did not change, so no cache has to be migrated or downloaded again. (2) *Hosting keeps the sync mode "full"* (tracks and stems, whatever was chosen; the choice comes back when hosting stops - `useAudioSyncReconciler`), as #932 had decided, so the manager never evicts what the host serves. An upload (`PUT /audio`) is stored under the revision the band's song list names (else the plain key until it does) and replaces older files of the track (`host/hostAudio.ts`). This answers #954: a track uploaded to the tablet host had been gone after a restart because the manager evicted the plain key. **Verified on the Redmi (2026-11-19):** sync mode "none" chosen for the band, 3.5 MB track uploaded to the tablet host, app force-stopped and restarted: the track is still served with identical bytes (SHA-256) and the cache still holds `var1:trk1` - the case that failed before (#954).

**Band accounts in the band database (#960, 2026-11-19; Marco: one database for every platform, CouchDB goes, the laptop must not be required).** Logins and admin PINs are documents of the band, handled by one module (`sync-host` `createBandAccounts`) on every host: `account:<username>` (a device login: PBKDF2 verifier, roles, or `revoked`) and `anchor:<profileId>` (an admin's PIN verifier). One document per login, never a shared list, so two hosts that add a device while apart never edit the same document; removing someone keeps the document as `revoked` so the removal replicates. `createBandJoin` holds the rules of `join` and `verify-admin-pin` (non-admin without password; admin: the first time chooses a 4-digit PIN, later the PIN or the last 4 digits of the band code - the recovery way in; one count of wrong PINs per person for both routes, 5 tries, 5 minutes). Both routes are in the shared table (`joinBand` dependency; absent = not registered). **Trade-off, accepted:** every device of the band can read the PIN verifiers, so a 4-digit PIN can be guessed offline by a member - as the recovery code already lets any member become admin. Writes of `account:`/`anchor:` are limited to the role `host` (and the server admin) by the roster validator. **Not yet:** the Stage-Server still answers join and PINs from CouchDB (its own handlers; the shared routes are not registered there), and a laptop login needs the role `host` before a laptop can push these documents - both come with step 3 of #960. The tablet accepts the new logins and, for now, still the older `host-accounts`. A `Retry-After` header is set by the Stage-Server only; on the tablet the seconds are in the body.

**Members on every host (#960, step 2b).** `createBandMembers` holds the rules of the Stage-Server's member routes, once: add (an admin gets the PIN chosen, or a fresh 4-digit one - no anchor login any more, the answer's `password` *is* the PIN), give/take admin (at least one admin must remain; no admin takes away their own rights), remove (never oneself, never the last admin), reset another admin's PIN (a fresh 4-digit one to read out; their devices stay signed in), choose one's own PIN (from one's own device, which gets a fresh login), and a device taking on another person (`activate`: re-picking its own person changes nothing; otherwise the same decision as joining, `become`). Every change needs a device login of this band with the admin role; wrong tries are counted per login name. Six routes in the shared table (`members` dependency; body 400 first, then 503 while passive, then the band - an unknown band answers like a wrong login). The roster is read from the band's `profiles:*` documents. The Stage-Server still uses its own handlers.

**The built-in database host checks the band's own accounts (#960, step 3a).** `createCouchHost` now accepts, for a request to a `stageboard-*` database, a device login that lives *in that database* (`account:<username>`, `createBandAccounts`) - after the older `_users` accounts, so nothing that worked stops. Each band has its own accounts instance with its own remembered logins (5 min), so a login of one band is never taken for another's; the host-wide remembered-login map is not used for them. The adapter over a PouchDB-shaped database (`createBandAccountStore`) moved from the app into `sync-host`: the tablet and the laptop's built-in host use the same one. **Device check:** a login the tablet host minted for a device signed in on the laptop host (backup, built-in database) about 5 s later, once the account document had replicated; a wrong password and another band's database were refused (401 / 403). **Still:** the Stage-Server's own provisioning (founding, join, members, PIN) writes `_users` - step 3b moves it onto the same accounts, then the older path can go.

**The Stage-Server runs on the same accounts and the one database (#960, step 3b).** `STAGEBOARD_DB` is gone: the built-in database host is the only database, CouchDB is no longer started or needed. The Stage-Server keeps no account list of its own any more: founding a band, joining, the admin PIN and every member change go through `createBandJoin` / `createBandMembers` (the shared routes, registered with `joinBand` / `members`) over the band's own documents (`createBandAccountsFor`: the adapter writes them over HTTP as the server admin). Gone: the Stage-Server's own join / verify-admin-pin / member / activate / set-pin handlers, `resolveOutcome`, `verifyUser` (no `_users`), `host-accounts` with its publisher and importer, the `host-accounts` rule of the roster validator. Founding gives the founding device its own admin login like every device (`deviceId` in the request, optional); a band's id taken means its database exists. Deleting a band deletes its database - and with it every login and PIN. The CLI `admin:reset` sets a PIN and the admin role through the same accounts. **Device check (laptop host E, built-in database only; tablet and laptop app 1.1970):** the laptop alone founded a band, signed the founder in to its database (a wrong password 401), refused founding it again (409), served the roster, added members and an admin, let a plain member join and refused it admin changes (403), had the founder's second device choose a PIN (400 without one, 201 with), checked the PIN and the recovery suffix, reset another admin's PIN, gave and took admin, removed a member (whose login was then refused, 401) and locked the right PIN after 5 wrong tries (429, 300 s). Across hosts: a login the tablet host minted signed in on the laptop host ~5 s later, and a login the laptop host minted signed in on the tablet as soon as it was host again. **Not done:** the host role (writing `account:` / `anchor:` is for `_admin` and `host` only - nothing gives a device that role yet, so a device's own sync cannot push them; hosts copy them with the replication account and the catch-up, which is how the checks above worked); CouchDB files in the repo (docker-compose, setup scripts, backup scripts, CI) - step 5; the old logins of devices paired before this change (a test band's devices have to join again; no band is in production).

**CouchDB removed from the repository (#960, step 5).** `docker-compose.yml`, `docker/couchdb-recovery.ini` and `scripts/setup-couchdb.sh` are gone; docs/03 describes the one database (§0b1) and no longer a Docker volume; CLAUDE.md and README say so. `COUCHDB_URL` / `COUCHDB_USER` / `COUCHDB_PASSWORD` and `~/.config/stageboard/couchdb.env` keep their names - they now name the built-in database's admin login, and renaming them would break every installed service. `couch.ts` keeps its name too (it is the HTTP client of the database host; the protocol is CouchDB's). **Found and fixed on the way:** (1) the built-in host answered `GET _security` with its internal `_id` and `_rev`; a backup that read the rules and put them back failed on the foreign revision - and `scripts/backup-restore.mjs` did not notice, so a restored band had no access rules and nobody could read it. The host now answers as CouchDB does (admins and members only) and ignores an id or revision in a `PUT`; the restore script fails loudly if it cannot put the rules back. (2) **A deleted band was recoverable with CouchDB (#362: `enable_database_recovery`) and would have been gone for good with the built-in host.** Every delete (`DELETE /workspaces/:id`, `npm run band:delete`) now first writes the band's current documents and its access rules to `<STAGEBOARD_STATE_DIR>/deleted-bands/stageboard-<id>-<date>_<time>/couchdb/…json` (owner-only, in the format of `scripts/backup.mjs`), and a band whose copy cannot be written is not deleted; `scripts/backup-restore.mjs <dir> stageboard-<id>` brings it back. Without revision history. **Device check (laptop host E):** founded a band, wrote a profile and a song, deleted it (204, the login refused afterwards), found the copy (mode 600), restored it (5 documents), and the old login signed in again and the song was back. **Not covered:** old CouchDB data on a server that used CouchDB before (no band is in production, so no migration was built); a long-running soak test of the built-in host.

**Still open:** the locked-screen throttling (§6g) needs the host module outside the page - see "Locked screen - what was tried".

**Measured (2026-11-18, Redmi as the backup, laptop host as the primary, home Wi-Fi, test band, no song playing):**
- The tablet verified the laptop's signed lease (WebCrypto) and showed it alive.
- Primary killed: the tablet took over after **~5.0 s** (epoch 17 → 18), `/server/active-workspace` named the band, `/db` served a band login.
- Primary started again: it came back out of date (`active:false`, epoch 17) - never two hosts. Its catch-up copy from the tablet needed a login on the tablet (`POST /host/replication-account`, issued only while the tablet is host); then the laptop took the host role back (epoch 19) and the tablet went passive.
- Found on the device: a throwing probe of the primary counted as "primary still there" - no takeover. Fixed (#947).
- **Not yet measured:** devices following the tablet during a running song (follow time, drift), a song written during the takeover, battery. Needs a gig-like run with two more devices.

## 7. Proposed order

Issues since 2026-11-10: tracking issue **#777**, under it #778 (real run of `sync-host`), #779 (move from CouchDB), #780 (installer Windows/Mac), #781 (spike Android as host), #782 (host fails during the gig, §6e).

1. ✅ (2026-11-10, #784) Work out this concept and switch docs/02 to the tiers; core principle 1 rewritten.
2. Server with PouchDB instead of CouchDB as an option + installer for Windows/Mac → tier 2 on laptops and Windows tablets. Biggest gain for the smallest effort; many bands already have a laptop.
3. Android as host: sync + clock + push for 3-4 devices over its own hotspot, measured as for clock sync (docs/09). Spike done (§6a), the real tier is #781.
4. Host backup (§6e, #782): first the no-host mode, then the add-on.
5. iPad for now only as a client with clearly named limits; an own iOS app depends on the store/price questions from docs/16.

## 8. Open

- ~~Do the three operating tiers replace the five tiers from docs/02?~~ Decided 2026-11-10 (Marco): replace - docs/02 rewritten, core principle 1 rewritten (#784).
- ~~What happens when the host fails in the middle of a gig?~~ Decided 2026-11-17 (Marco): §6e - a primary and a passive backup in an add-on, plus the no-host mode in the core.
- Host backup: whether the master device may start the next song for everyone without a host (§6e); the exact list of reasons for a takeover request; how long the primary must be healthy before the handback.
- Battery and load: can a host tablet be hotspot, server and its own playing device at once? (#781)
- Which add-ons could still work on tier 2 (e.g. Piper in the browser).
- Relation to marketing (docs/16): tier 1/2 as Free/Band, the box as its own product?
