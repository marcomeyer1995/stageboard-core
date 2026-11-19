# 33 Distribution and remote access

How StageBoard reaches a band's devices - Android, Windows, Mac, Linux, iOS and the browser - how it updates, and how members sync from home **without a central service of ours**. Concept of 2026-11-17, decisions from that day's conversation with Marco (§0). Tracking issue: #886. Builds on docs/25 (host as a role, operating tiers), docs/32 §12 (add-ons from GitHub releases), docs/16 (stores, money, licence).

## 0. Decisions (Marco, 2026-11-17)

| Question | Decision |
|---|---|
| Desktop | **A native desktop app** - host and player in one - for Windows, Mac and Linux, like the Capacitor app on Android. The browser stays the zero-install fallback. Technology: Electron (§3) |
| Channels | **Not separated.** Nobody knows in the end where an install came from; Google Play, the website download and the APK from the host must all be the same app that can update over each other (§4) |
| Google Play | **Yes**, a good channel - next to the website and the host, not instead of them |
| Central service | **None of ours is required.** Each band is responsible for its own installation, as with Home Assistant: sync from home goes through the band's own always-on host (§7). An optional relay run by us stays a later possibility, not a dependency |

## 1. Where we are

- **Android:** the Capacitor app (`de.stageboard.app`), UI inside the APK, certificate pinning; the APK comes from the band's own Stage-Server (`/app`), which also offers updates (docs/03 §0c). Not in any store.
- **Host:** the Node server - on Linux as a systemd service; the database is the built-in database host (docs/25) in the same process, no Docker. It was measured on Linux and Windows on 2026-11-17 (#778) against the CouchDB it replaced: as fast, less than half the memory. On Android as a spike (#781).
- **Browser:** any device opens the host's address and gets the web app - with a self-signed certificate, so a warning, no PWA install, and the rough edges seen on the Windows PC on 2026-11-17.
- **iOS/Mac:** nothing yet.

## 2. Platforms

| Platform | Role | What it gets | Delivered via | Hurdle |
|---|---|---|---|---|
| **Android** | player, later host (#781) | the Capacitor app | Google Play, website download, the host's `/app` - one app (§4) | Play: 25 $ once, review, policies (foreground service, USB) |
| **Windows** | host + player | the desktop app (§3) | website / GitHub Releases, later `winget` | code signing certificate (~200-400 €/year), otherwise SmartScreen warns on every install |
| **Mac** | host + player | the desktop app | website (.dmg), later Homebrew | Apple developer account (99 $/year) and notarization are mandatory, otherwise macOS blocks the app |
| **Linux** | host + player; or a dedicated Stage-Server | desktop app (AppImage/.deb); **headless package** with a systemd service for a box without screen (§3) | website / GitHub Releases, later an apt repository | none |
| **iOS / iPadOS** | player only | Capacitor iOS app from the same frontend, with native MIDI (CoreMIDI) and the C++ audio engine - Safari/WKWebView has no WebMIDI | App Store only (TestFlight for beta) | 99 $/year, review, a Mac to build. **Only after the demand check (docs/16 §4)** |
| **Browser** | player, zero install | the web app the host serves | nothing to distribute | the certificate (§8); background tabs throttled |

## 3. The desktop app

**Why an app and not just the browser:**
1. **The host has to be installed anyway** - a browser can't run a server. If a program is installed, it can be the player too.
2. **No throttling:** browsers slow down or freeze timers in background tabs - the same trouble as a locked Android screen (#724). An app window does not.
3. **Certificate and autoplay:** the app trusts its band host's certificate itself (pinning, as on Android) and may play sound without a click first.
4. **Native audio later:** the C++ engine (miniaudio, docs/30 §8h) can run in the app instead of Web Audio - lower latency, the exact output device, multichannel interfaces; on the desktop what AAudio is on Android.

**Why Electron and not Tauri:** the app must behave like Chrome on every system. Electron brings its own Chromium - WebMIDI, Web Audio and our WASM engine behave the same everywhere. Tauri uses the system's web engine, which on the Mac is Safari's: no WebMIDI, different audio. Cost: ~100 MB per download.

**What it does:**
- Starts the host (Node, built-in database, HTTPS with its own certificate, mDNS) in the background; a **tray icon** keeps hosting with the window closed; optional autostart.
- Shows the player window - the same frontend as Android and the browser.
- Data directory in the user profile (`%APPDATA%`, `~/Library/Application Support`, `~/.local/share`).
- Updates itself (Electron's updater, from GitHub Releases or our website - static files, no service of ours).
- A host on a laptop usually can't use port 443 - the invite QR code must carry the port (finding of #778).

**Headless Linux package** for a dedicated Stage-Server (the "box" of docs/02, docs/16 §E): the host without window as a systemd service, built-in database, no Docker. CouchDB is no longer needed (#960), so the productive server here can move to it (#779).

**Lessons from the Windows test of 2026-11-17 (#778)** for the packaging: Node and all dependencies must be inside the package (no `npm`, the execution policy blocks `npm.ps1`); the firewall rule must cover "Public" networks or ask; moving a band by replication must copy `_security` too (#779).

## 4. One app, many channels

**One signing key for all channels.** An app update must be signed with the same key as the installed app. Google Play allows using **our own app signing key** instead of one Google generates - then the Play build, the website APK and the host's `/app` carry the same signature, and any of them can update an install from any other, as long as the version number rises. The key that exists today (`~/stageboard-data/android/`, #363) becomes that key - so it must be in Play before the first upload and must never be lost.

**Play's one rule:** an app installed from Google Play may only update through Google Play (policy "Device and Network Abuse"). The app reads where it was installed from (`getInstallSourceInfo`):
- **from Play:** the host shows that a newer version exists - "update in the Play Store"; it does not install an APK itself;
- **from anywhere else:** as today, the update comes from the host (`/app`), or from the website.

For the user it is the same app with the same data; switching channels needs no reinstall.

**Desktop:** the same idea - the updater fetches from GitHub Releases or the website; a band host can additionally offer the installers to its members (useful offline).

## 5. Versions between host and players

Browsers always get the host's version. Native apps bring their own UI, so host and players can differ - a band never updates all at once, and an offline band can't. Rules:
- The host announces its version and the **oldest player version it still supports**; a player announces its own.
- Too old for the host: the player says so clearly ("update the app") instead of failing in odd places. Newer than the host: works, features the host doesn't have yet stay grey (graceful degradation, core principle 2).
- Every change to the protocol (database documents, live channels, endpoints) keeps the previous player version working for a while; documents follow the existing rule "optional fields" (tools/server/deploy-ref.sh).
- The add-on versions (docs/32 §10, `apiVersion`) follow the same pattern.

## 6. First start

Install from any channel → **Solo works immediately** (tier 1, docs/02) → "Create band" makes **this device the host** (desktop; Android once #781 is done) or **finds a host** on the network (mDNS) → members join by QR code or code. The end-to-end run without the maintainer is #791; it decides how "foolproof" the start is (core principle 3).

## 7. Remote access: each band runs its own

Members want to edit songs and setlists at home and find everything at the next rehearsal. Phones and tablets at home are rarely online at the same time, so a band needs **one host that is always on and reachable from outside** - the band's, not ours. Our multi-master replication already does the rest: at home a device syncs with that host, at the gig with the local one, and everything merges at the next contact. The gig never depends on it (core principle 1).

| Option | What the band needs | Reaching it | Effort for the band |
|---|---|---|---|
| **Home host + private network (Tailscale or similar, recommended)** | a member's PC, NAS, Raspberry Pi or the box, running the desktop app or the headless host | every member's device joins the band's private network; free for small groups, no router changes; Tailscale also issues real HTTPS certificates for it | low - we guide through it |
| Home host + port forwarding / DynDNS | as above, plus router setup | open to the internet; certificate via Let's Encrypt | medium; error-prone, a security risk, impossible behind CGNAT |
| A rented small server (VPS, ~4-5 €/month) | the headless host there | directly reachable | medium; always on, independent of anyone's home |
| *Later, optional:* a relay run by us | nothing | a paid convenience, like Nabu Casa for Home Assistant | none for the band - operating effort for us; not planned now |

**In the app:** a guided "Access from home" setup - choose the always-on host, set up the private network, test from outside, done. Must be foolproof; that is real product work.

**Security for a host reachable from outside:** 4-digit PINs must never be valid from outside - only long device keys (as decided for hosts in docs/25 §6c); rate limits on sign-in; updates matter more. With a private network (Tailscale) the host is not on the open internet at all - one more reason to recommend it.

## 8. What stays without a central service

| Earlier thought of as "cloud" | Without a service of ours |
|---|---|
| Sync over the internet | the band's own host (§7) |
| Calendar, availability (#487) | ordinary band data - replicates to every device like songs; **reminders are scheduled locally** on each device from that data (local notifications), so no push server |
| Backup (#363) | to the band's host, NAS or a USB medium (the backup function exists) |
| App updates, add-on catalogue | static files on GitHub Releases (docs/32 §12) |
| Certificates | native apps on every platform pin the host's certificate, so a certificate service is **not needed**; the hard case left is a pure browser player and the iPad in the browser - with Tailscale its certificates cover that too |
| Licences | open with #787; nothing that has to be online |

**What this means for the maintainer:** no servers to run, no running costs, no availability duty; legally much simpler - each band is responsible for its own data, StageBoard is only the software. No data-processing agreements, no hosting of other people's lyrics and tracks.

## 9. Accounts, signing, money

| What | Cost | Note |
|---|---|---|
| Google Play developer account | 25 $ once | the EU shows name and postal address publicly (docs/16 §D) |
| Apple developer account | 99 $/year | Mac notarization and iOS; a Mac to build |
| Windows code signing certificate | ~200-400 €/year | without it SmartScreen warns |
| Domain for the website | small | releases and docs; optional if GitHub Releases are enough |

**Prerequisites:** GitHub Releases, `winget` and F-Droid need a public repository - so the history review (#786) and the licence (#787) come first. iOS waits for the demand check (docs/16 §4).

## 10. Order

1. **Beta with a few bands:** Android APK from the website plus the host's update (as today, one key); desktop app for Windows and Linux; the version check (§5); browser players with the self-signed certificate as today.
2. **Public:** Google Play with our own signing key; signed desktop apps for Windows, Mac (notarized) and Linux; the headless Linux package; "Access from home" (§7).
3. **iOS**, once the interviews (docs/16 §4) show iPads are a must.
4. Native audio in the desktop app when a band needs interfaces on the laptop.

## 11. Issues

Tracking #886: #780 (desktop app, rescoped), #887 (one signing key, installer source), #888 (Google Play), #889 (version check host ↔ players), #890 (headless Linux host), #891 (access from home), #892 (accounts and signing), #893 (iOS app, parked), #894 (native audio in the desktop app, later). Related: #487 (calendar: reminders locally, §8), #363 (backup and the signing key), #779 (band move), #781 (Android host), #786/#787 (before going public), #791 (first start), #792 (release checklist).

## 12. Open

- Which private-network product to recommend first (Tailscale, or a self-hostable one like Headscale/NetBird), and whether the app can set it up itself on Android/desktop.
- Whether the desktop app's player and the browser player should differ at all beyond certificate and audio.
- The website: own domain or only GitHub Pages.
- When the optional relay (§7) would be worth it - only if bands ask for it.
