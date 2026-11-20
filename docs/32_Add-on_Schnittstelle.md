# 32 Add-on-Schnittstelle

Für Leute, die ein Add-on für StageBoard schreiben wollen – ein Mischpult, ein Lichtpult, ein Effektgerät, einen Importer, ein Werkzeug. Beschreibt, **was ein Add-on darf und wie es mit StageBoard spricht**. Jeder Abschnitt sagt, ob das heute **gebaut** ist oder erst **geplant** – gegen „geplant“ lässt sich noch nicht programmieren.

Grundsatz (docs/01 §1): StageBoard ist ein kleiner Kern, alles andere sind Add-ons aus eigenen GitHub-Repositories, die eine Band nach ihrer Ausstattung zusammenstellt. Die App wird ohne Add-ons Dritter ausgeliefert; wer eins installiert, entscheidet und verantwortet das selbst.

## 1. Zwei Arten von Add-ons (Marco, 2026-11-10)

| Art | Wofür | Läuft | Sicherheit |
|---|---|---|---|
| **JS-Add-on** (der Normalfall) | alles, was sich in TypeScript/JavaScript schreiben lässt: Geräte über MIDI/OSC/Netz, Widgets, Importer | auf jedem Host gleich – Laptop, Android-Host, Browser, Tablet – in einer **abgeschotteten Umgebung** | sieht nur, was es im Manifest anmeldet und die Band erlaubt |
| **Natives Hilfsprogramm** | was eine Bibliothek in einer anderen Sprache braucht: YouTube (Java/Python), Stem-Trennung (Python/Demucs), Sprachausgabe (Piper) | je Plattform ein eigenes Programm: auf dem Laptop/PC ein Programm, auf Android ein eigenes App-Paket | eigener Prozess, eigene Sandbox des Betriebssystems; bekommt nur, was StageBoard ihm über die Schnittstelle übergibt |

Ein Add-on kann beides haben: einen JS-Teil, der in StageBoard eingebunden ist, und ein Hilfsprogramm, das der JS-Teil aufruft. Das Manifest sagt, welches Hilfsprogramm auf welcher Plattform gebraucht wird; fehlt es auf einem Host, zeigt die Bühnen-Karte das Add-on dort als „Hilfsprogramm fehlt“ (Graceful Degradation, docs/07).

Warum natives Hilfsprogramm als **eigener Prozess bzw. eigenes App-Paket** und nicht in StageBoard nachgeladen: fremder nativer Code liefe sonst mit allen Rechten von StageBoard (Banddaten, Logins, Mikrofon), eine Signatur sagt nur, *wer* ihn geschrieben hat; ein abstürzendes Hilfsprogramm reißt keinen Gig mit; jeder kann eins bauen, ohne StageBoards Signierschlüssel, unter eigener Lizenz und mit eigenen Updates.

## 2. Das Manifest – *gebaut*

Ein installiertes Add-on ist ein Dokument der Band (`PluginInstallation`, `shared-types/src/pluginInstallation.ts`) und verteilt sich über die normale Synchronisation an alle Geräte und den Host – es gibt keinen zweiten Weg. Es trägt das **Manifest**, nicht den Code.

| Feld | Bedeutung |
|---|---|
| `id`, `name`, `version` | eindeutige ID (`kemper-profiler`), Anzeigename, Version (SemVer) |
| `runtime` | `client` (läuft auf dem Gerät), `server` (auf dem Host), `both` |
| `capabilities` | was das Add-on kann – das Vokabular, mit dem Widgets ihre Anforderungen angeben (§3) |
| `transports` | über welche Wege es ein Gerät ansteuern kann und welche Einstellungen jeder braucht (z. B. `usb-midi` braucht `midiOutputId`) – die Werte je Gerät liegen woanders (`DeviceTransportConfig`) |
| `hardwareIds` | Merkmale zum Wiedererkennen angeschlossener Geräte (MIDI-Portname, USB-IDs), ohne den Code zu laden |
| `discoveryTrigger` | wie die Geräteerkennung den Musiker bittet, sein Gerät zu zeigen (z. B. „Taste drücken“), wenn zwei gleiche da sind |
| `timing` | je Fähigkeit: Timing-Klasse, ob `scheduledAt` selbst eingehalten wird, bekannte Latenz, Kalibrierung (§5, docs/21) |
| `settings` | Einstellungen der Band für dieses Add-on, frei geformt; das Add-on prüft seinen Teil selbst (Zod) |
| `clientSource` | URL des JS-Bundles für die Geräte (§4) |
| `source` | URL des Server-Codes – *geplant* (§6) |
| `enabled`, `installedAt` | an/aus, Zeitpunkt |

Seit #756 (2026-11-10) *gebaut*, alle optional: `apiVersion` (welche Version dieser Schnittstelle das Add-on spricht, §10), `permissions` (§7) und `helpers` (§8). Ein eingebautes Add-on, das vor den Feldern installiert wurde, bekommt sie auf dem Gerät aus dem Katalog des Builds.

## 3. Fähigkeiten (Capabilities) – *gebaut*

Eine Fähigkeit ist ein frei wählbarer Name (`CapabilityId`, ein String) – das Bindeglied zwischen Add-on und Oberfläche: das Add-on sagt, was es kann, ein Widget, was es braucht. Fehlt die Fähigkeit, geht das Widget in den Disabled State, statt abzustürzen (Kern-Prinzip 2).

StageBoards eigene (`CAPABILITIES` in `shared-types/src/capability.ts`): `mixer`, `lighting`, `show-control`, `midi-input`, `audio-playback`, `click-track`, `backup`, `audio-analysis`, `midi-clock`, `midi-controller`, `speech-synthesis`, `stem-separation`, `section-announcements`, `chord-import`, `video-download`. Ein Add-on darf eigene bringen; für ein bestimmtes Gerät eine **eigene** Fähigkeit statt einer allgemeinen (z. B. `kemper-profiler`, nicht `mixer`), damit zwei Geräte derselben Art nebeneinander gehen.

## 4. JS-Add-on auf dem Gerät – *teilweise gebaut*

**Gebaut:** Ein Add-on mit `clientSource` wird beim ersten Gebrauch geladen (vom Host gespiegelt unter `/plugins/<id>/client.js`, sonst direkt), unter `id@version` zwischengespeichert und ist offline danach weiter da (`stage-pwa/src/lib/loadClientPlugin.ts`). Das Bundle ist ein ES-Modul mit einem `ClientPluginModule` als `export default`:

```ts
export default {
  id: 'kemper-profiler',
  // Pflicht für Geräte-Add-ons: führt ein Ereignis aus (§5).
  registerTranslator: (capability) => async (event) => {
    // … MIDI senden, Antwort prüfen …
    return { status: 'ok' }
  },
  // Vorgesehen, Form noch offen: Widgets, Editor-Panel, Hardware-Erkennung.
  registerWidgets: () => [],
  registerEditorPanel: (capability) => null,
  registerHalProbe: () => null,
}
```

**Achtung:** heute läuft das Modul **in der Seite selbst**, mit ihrem vollen Zugriff. Für Add-ons Dritter ist das nicht tragbar.

**Geplant – die Sandbox:** Jedes JS-Add-on läuft in einem eigenen Worker. Es sieht weder die Banddaten noch die Logins noch die Seite; es spricht mit StageBoard nur über Nachrichten, und StageBoard führt aus, was das Add-on darf (§7):

| Richtung | Nachricht | Inhalt |
|---|---|---|
| StageBoard → Add-on | `init` | `apiVersion`, die Einstellungen der Band (`settings`), die erlaubten Rechte, die Transport-Einstellungen dieses Geräts |
| | `event` | ein `ShowControlEvent` (§5), mit `id` für die Antwort |
| | `midi-in` | eingehende MIDI-Nachricht eines erlaubten Ports, mit Zeitstempel |
| | `shutdown` | aufräumen, gleich wird beendet |
| Add-on → StageBoard | `result` | `ShowControlResult` zu einem `event` |
| | `midi-out` | Bytes an einen erlaubten Port, optional mit Zeitstempel (Band-Zeit) – StageBoard sendet mit WebMIDI-Zeitstempel (Worker haben kein WebMIDI) |
| | `osc-out`, `http` | nur mit dem Recht dafür, nur zu angemeldeten Zielen |
| | `health` | `online` / `offline` / `error` + Meldung (§9) |
| | `log` | Zeile fürs Protokoll |

*Built (2026-11-17, #757, in English per #785):* the sandbox for device add-ons - `stage-pwa/src/lib/addonSandbox/` (`protocol.ts`, `sandboxHost.ts`, `sandboxTranslator.ts`). An add-on installed from its own repository (`clientSource` under `/addons/…`, §12) runs as a **classic Worker script** (no imports) from the host's checked copy and replaces a built-in translator for its capability; others are untouched. Messages as in the table, version 1 (`ADDON_PROTOCOL_VERSION`): `init` also carries `protocol` and the app's `language`; `event` carries `context.midiChannel` (the device's channel - StageBoard picks the device and port, the add-on never names a port). **Added:** `midi-out` may ask for a reply (`request`, `expectReply: { prefix, timeoutMs }`); StageBoard then listens on the same device's input *before* sending and answers with `midi-reply` (the identity handshake needs it - a reply can be faster than a listener attached afterwards, found with the real MG-30 on 2026-09-08). `midi-out` without a `midi-out:` permission is refused; an event without an answer fails after 5 s. First add-on: [stageboard-addon-nux-mg30](https://github.com/marcomeyer1995/stageboard-addon-nux-mg30) (release v0.1.0).

Widgets eines Add-ons kommen als Beschreibung (welche Bedienelemente, welche Werte), nicht als eigener React-Code – damit sie in StageBoards UI-System (docs/15) bleiben und das Add-on keinen Zugriff auf die Seite braucht.

## 5. Ereignisse und Zeit – *gebaut*

StageBoard schickt einem Add-on Ereignisse (`ShowControlEvent`, `shared-types/src/plugin.ts`) – aus Cues der Timeline, Aktionen (Pedale, MIDI-Controller, Knöpfe, docs/23), dem Show-Ablauf:

```ts
{ type: 'preset.load', payload: { rig: 3 }, scheduledAt: 1762790400123, logicalDeviceId: 'kemper-marco' }
```

- `type` und `payload` legt das Add-on selbst fest (sein Befehlssatz); StageBoard reicht sie durch.
- `scheduledAt`: Band-Zeit (ms), zu der es wirken soll – Ahead-of-Time-Dispatch (docs/00 §4). Ein Add-on, das ihn selbst einhält (z. B. per MIDI-Zeitstempel), meldet das im Manifest (`timing[].honoursScheduledAt`); sonst wartet StageBoard bis dahin und ruft dann auf.
- `logicalDeviceId`: welches Gerät, wenn die Band zwei derselben Art hat.

Antwort (`ShowControlResult`): `status: 'ok' | 'error'`, Meldung als Text oder besser als Code mit Parametern (`messageCode`, `messageParams` – übersetzt das Gerät, docs/03), optional `data`.

**Timing-Klassen** (`timing[]`, docs/21): `sample` (±2 ms, Audio), `realtime` (±10 ms, Klick-nahe Geräte, Licht im Takt), `soft` (±100 ms, Preset-Wechsel), `none` (wann es ankommt). Dazu die bekannte Latenz und wie man sie misst (Licht-, Ton-, MIDI-Rückweg- oder Kamera-Sensor) – StageBoard sendet entsprechend früher.

## 6. Hintergrund-Aufgaben (Jobs) – *eingebaut; die Sandbox dafür in Arbeit (#964)*

**Es gibt keinen Server.** Ein Add-on läuft auf den Geräten, die es können, und auf anderen nicht: `runsOn` im Manifest (Plattform, Kerne, Speicher) und die Hilfsprogramme (§8) entscheiden, nicht eine Rolle des Geräts. Dasselbe JavaScript-Add-on läuft in derselben Art Sandbox (§4) - auf einem Tablet in einem Worker der App, auf einem Laptop in einem eigenen Node-Prozess mit Nodes Permission-Modell (`--permission`: nur erlaubte Verzeichnisse, kein Starten von Programmen außer den angemeldeten Hilfsprogrammen) - und spricht dieselben Nachrichten.

**Gebaut:** Aufgaben für Geräte (§4: Ereignisse an ein MIDI-Gerät) und die eingebauten Hintergrund-Aufgaben (YouTube, Stem-Trennung, Sprache): `IShowControlPlugin` (`init`, `trigger`, `shutdown`), die Rezepte in `sync-host/jobs/` laufen **ohne Sandbox** im Prozess des Geräts, das die Aufgabe nimmt; welche es gibt, steht fest im Code (`core-backend/src/plugins/catalog.ts`).

**In Arbeit (#964):** die Aufgaben-Nachrichten (`job`, `job-progress`, `job-result`, `helper-run`) im gemeinsamen Protokoll (`shared-types/addonProtocol.ts`) und die Laufzeit dafür auf Node (`--permission`). Die Datei dafür heißt im Manifest `jobsFile` (früher `serverFile`).

Lange Aufgaben (Stems trennen, Download) laufen als **Job**: ein Band-Dokument mit Status und Fortschritt (`asyncJob.ts`), das jedes Gerät sieht; welches Gerät es nimmt, entscheidet seine Fähigkeit (`sync-host/jobQueue.ts`, docs/25 #964).

## 7. Rechte – *Feld gebaut (#756), Durchsetzung geplant*

Das Manifest meldet an, was das Add-on braucht (`permissions`, Form `PermissionSchema`); die Band bestätigt es beim Installieren (wie Android-Berechtigungen, #763). Durchgesetzt wird es in der Sandbox (#757, #761): ohne Recht keine Nachricht.

| Recht | erlaubt |
|---|---|
| `midi-out:<Port-Muster>`, `midi-in:<Port-Muster>` | MIDI an/von passenden Ports |
| `osc:<Host:Port>` | OSC senden/empfangen |
| `http:<Ursprung>` | HTTP zu genau diesen Adressen (Geräte-API, ein Import-Dienst) |
| `audio-store` | Tracks der Band lesen/schreiben (Importer, Stem-Trennung) |
| `songs:read`, `songs:write` | Songs/Varianten lesen bzw. ändern (Importer) |
| `helper:<id>` | sein eigenes Hilfsprogramm aufrufen (§8) |

Nie, für kein Add-on: Logins, Schlüssel, Konten, Geräte-Passwörter, andere Bands.

## 8. Native Hilfsprogramme – *Zeilenprotokoll gebaut, Rest geplant*

Ein Hilfsprogramm ist ein eigenes Programm je Plattform. StageBoard ruft es mit Argumenten auf und liest seine Ausgabe – dasselbe **Zeilenprotokoll** auf jeder Plattform:

```
PROGRESS 0.42
RESULT {"files":[{"key":"drums","file":"drums.opus"}]}
```

- `PROGRESS <0..1>` beliebig oft; `RESULT <json>` einmal als letztes; Fehler: Ende mit Code ≠ 0, Grund in der Fehlerausgabe (letzte Zeilen).
- Dateien: in ein Arbeitsverzeichnis, das StageBoard vorgibt und danach aufräumt. Audio immer als **Ogg Opus** (docs/30 §8h).
- *Gebaut* so: Stem-Trennung (`core-backend/scripts/stem_separate.py`); `yt-dlp` hat ein eigenes Format, das StageBoard übersetzt.

**Laptop/PC** – *gebaut für die eingebauten*: ein Programm auf dem Host (`yt-dlp`, Python mit Demucs, Piper); der Host meldet je Add-on, ob es da ist (`GET /host/capabilities`).

**Android** – *geplant, erstes Beispiel: YouTube* (docs/25 §6b): ein **eigenes App-Paket** neben StageBoard, ohne Symbol auf dem Startbildschirm.
- Es bietet einen gebundenen Dienst mit den Aktionen `de.stageboard.helper` (gemeinsam für alle – seit Android 11 sieht StageBoard fremde Apps nur über eine fest angemeldete Aktion) und `de.stageboard.helper.<add-on-id>` an, dazu die Metadaten `de.stageboard.addon` = Add-on-ID und `de.stageboard.apiVersion`. StageBoard findet es über den Paket-Manager.
- Dieselben Nachrichten wie das Zeilenprotokoll (über Android-`Messenger`): Auftrag mit Argumenten → `progress`, `result`; Dateien als Datei-Deskriptor, nie über gemeinsame Ordner.
- Das Hilfsprogramm prüft, dass der Aufrufer StageBoard ist (Signatur des aufrufenden Pakets), StageBoard prüft das Paket gegen den Signatur-Fingerabdruck im Manifest.
- Installieren aus StageBoard: das Manifest nennt die APK (GitHub-Release) und ihren Fingerabdruck; StageBoard lädt sie und öffnet den Installationsdialog von Android. Ab dann zeigt StageBoard das Add-on als installiert; Updates genauso.

Im Manifest (*gebaut*, #756 – `HelpersSchema`; `certSha256` ist eine Liste, damit ein Schlüsselwechsel ohne Bruch geht; StageBoard liest die Vertrauensliste nur von hier, nie aus Code):

```jsonc
"helpers": {
  "desktop": { "program": "yt-dlp", "minVersion": "2026.08.19" },
  "android": { "package": "de.stageboard.helper.youtube", "minVersionCode": 1, "certSha256": ["…"] }
}
```

## 9. Zustand, Meldungen, Einstellungen – *gebaut*

- **Zustand** (`pluginHealth.ts`): `online` / `offline` / `error` + Meldung; von dem Gerät, das das Add-on ausführt. Ohne Meldung seit 15 s gilt es als offline – ein Add-on meldet sich also regelmäßig.
- **Meldungen** an Musiker als Code + Parameter, nicht als fertiger Text: das Gerät übersetzt (docs/03, #679).
- **Einstellungen** der Band in `settings`, repliziert; das Add-on prüft sie mit einem eigenen Schema und nimmt bei Unbekanntem seine Voreinstellung (nie abstürzen).

## 10. Versionen – *gebaut* (#756)

`apiVersion` ist die Version dieser Schnittstelle (`ADDON_API_VERSION`, heute 1; ein Manifest ohne Angabe gilt als 1). Kleine Erweiterungen bleiben rückwärtsverträglich; bricht etwas, steigt sie, und StageBoard lädt ein Add-on mit zu alter oder zu neuer Version nicht, sondern zeigt es im Add-on-Tab (und später auf der Karte) als „passt nicht zu dieser StageBoard-Version“ – der Host über den Zustand `error` mit dem Code `plugin.apiVersion`, das Gerät für seine eigenen Add-ons genauso.

## 11. Die eingebauten Add-ons – Umbau (Marco, 2026-11-10: „die anderen Pakete bauen wir entsprechend um“)

| Heute eingebaut | wird | Hilfsprogramm |
|---|---|---|
| Kemper, MG-30, RC-500, CQ-18T, Ui24R (Translatoren in `stage-pwa/src/lib/*Translator.ts`), MIDI-Clock | JS-Add-on | – |
| OSC (`oscPlugin.ts`) | JS-Add-on (Jobs-Datei, Recht `osc:`) | – |
| Sprachausgabe Piper | JS-Add-on | Laptop: Piper; Android: offen |
| Stem-Trennung | JS-Add-on | Laptop: Python + Demucs; Android: offen (zu schwer?) |
| Ultimate-Guitar-Import (Chrome über puppeteer) | JS-Add-on | Laptop: Chrome; Android: offen |
| YouTube-Download | JS-Add-on | Laptop: `yt-dlp`; Android: App-Paket mit NewPipeExtractor (zuerst) |

Reihenfolge: erst das YouTube-Hilfsprogramm für Android (prüft §8 an einem echten Fall), dann die Sandbox (§4/§6) mit einem Geräte-Translator als erstem Umzug, dann die übrigen.

## 12. Distribution: one repository per add-on – *concept* (#852, decisions by Marco on 2026-11-14)

*(In English per #785; the rest of this file is still German.)*

Today the catalogue is fixed in code (`core-backend/src/plugins/catalog.ts`, `stage-pwa/src/lib/pluginCatalog.ts`), and an Android helper comes onto a device only via adb. The goal is a catalogue a band builds itself from repositories.

### 12a. Decisions

| Question | Decision |
|---|---|
| Repositories | **one repository per add-on** (as HACS does for Home Assistant: "einheitlicher"), also for StageBoard's own add-ons, so there is no index file listing several |
| Scope | **per band**: the band's list of add-on sources lives in its database, like everything else of the band |
| Who | **only the admin** installs, updates, removes and manages the sources |
| Finding | a **suggestion list** in the Add-ons tab plus **"Aus Repository installieren"** (a GitHub address, also by QR code) |
| Suggestion list | StageBoard's own public repository listing recommended add-on repositories (like the HACS default list); developers ask to be added, Marco decides |
| Before installing | the add-on's **permissions** (§7, like Android app permissions), the **publisher** with a **warning if unknown**, **download size and exact source** (repository, release), **where it runs** (devices / host / needs a helper on Android or a laptop) |
| Updates | the host checks regularly and shows "Update verfügbar (v1.2 → v1.3)" with the changes; installed only **when the admin confirms**, **never during a gig** |
| Failure | the installed version **stays**: the host keeps its files locally, it keeps running when the repository disappears, and a broken update can be **rolled back** to the previous version |
| StageBoard's own add-ons | the **important ones are preinstalled** in every new band, the rest are loaded when needed. Which ones count as important is open. Proposal: section announcements, speech (Piper), MIDI clock |

### 12b. An add-on repository

A GitHub repository whose **releases** are the versions. The latest release that is not a pre-release is the current version, and its tag is the version (`v1.3.0` → `1.3.0`, SemVer).

- **`stageboard-addon.json`** in each release (as a release asset, so a version's manifest never changes afterwards): the manifest of §2 (`id`, `name`, `version`, `apiVersion`, `runtime`, `capabilities`, `transports`, `hardwareIds`, `timing`, `permissions`, `helpers`, settings schema), plus
  - `files`: every file of this version with its **SHA-256** and size: the device file (`client.js`), the jobs file (`jobs.js`), assets. Each `name` is an asset of the same release - a plain file name, no folders (a release's assets are flat, and a name can never leave the version's folder on the host).
  - `clientFile` / `jobsFile`: which of `files` is the device file every device loads, and the jobs file that any device satisfying `runsOn` runs (there is no server; #964).
  - *Built (2026-11-17, #852 steps 1-2):* `AddonReleaseManifestSchema` / `AddonSourceSchema` in `shared-types/src/addonRelease.ts`; the host's part in `core-backend/src/addons/addonStore.ts` - read the latest release, check the manifest (schema, version = tag, `apiVersion`, every file present), download, check each SHA-256, keep under `<state>/addons/<id>/<version>/`, keep two versions; routes `GET /addons/:id/:version/:file`, `POST /workspaces/:id/addons/preview` and `…/install` (admin only).
  - `changes`: a short text of what is new (shown with the update).
  - `minStageBoard`: the oldest StageBoard version it runs on, optional.
- **Helpers** stay as in §8: `helpers.android` names the APK (asset of the same release) and its signing certificate fingerprint; `helpers.desktop` names the program and minimum version. StageBoard downloads the APK and checks the fingerprint **before** opening Android's installer (#764).
- The **publisher** is the repository owner (`github.com/<owner>/<repo>`). It is "known" when it is StageBoard's own organisation or on the suggestion list, otherwise "unknown" and the warning shows. A future signature (as F-Droid has) can replace this.

### 12c. In the band

- **`addon-sources:<id>`** documents in the band database: repository URL, the version installed, the versions kept (for rollback), when last checked, and "publisher confirmed" (the admin accepted the warning once).
- The **installed add-on** stays the `PluginInstallation` of §2. Its `clientSource`/`source` now point to the **host's copy** (`/addons/<id>/<version>/client.js`), never to GitHub, so devices load from the host, also offline.
- The **host** downloads a version's files once, checks every SHA-256, keeps them under its state directory (`addons/<id>/<version>/`) and serves them. It keeps the current and the previous version (rollback). Without a host (Solo) the device does the same in its own storage.

### 12d. Flows

1. **Install from the suggestion list:** Add-ons tab → "Hinzufügen" → list (name, short text, publisher, where it runs) → an entry → the details of 12a (permissions, publisher, size, source, where it runs; the unknown-publisher warning when it applies) → "Installieren" → the host downloads and checks → the add-on appears like a built-in one today.
2. **Install from a repository address:** the same, after typing or scanning the address. An address that is not an add-on repository (no `stageboard-addon.json`, wrong `apiVersion`) gets a clear message.
3. **Update:** the host checks the sources (at start and every 24 h, not during a gig). A newer version → "Update verfügbar (v1.2 → v1.3)" with `changes` and **new permissions highlighted**. The admin confirms, the host downloads and checks, and the devices switch at the next idle moment (not mid-song).
4. **Rollback:** at an updated add-on, "Vorige Version" switches back to the kept copy, no download needed.
5. **Repository gone / no internet:** the add-on keeps running from the host's copy, and the source shows "nicht erreichbar seit …".
6. **New band:** the preinstalled set comes with the app (its files in the APK/web build), with updates from their repositories as for any other.

### 12e. Steps

1. **Manifest file and release layout** (`stageboard-addon.json`, schema in shared-types, `files` with SHA-256) and one real repository as reference: the YouTube add-on (its helper repo exists).
2. **Host:** sources documents, download + verify + serve (`/addons/…`), keep two versions; the device in Solo the same.
3. **Install from an address** in the Add-ons tab with the details screen and the warning (#763's scope, done this way).
4. **Suggestion list:** StageBoard's list repository and the list in the tab.
5. **Updates and rollback**, never during a gig.
6. **Helper install from StageBoard** (#764) on top of 1–3.
7. **Move the built-in add-ons** into their own repositories one by one (§11), and define the preinstalled set.

### 12f. Acceptance

- Install an add-on that is not built in (the MG-30 translator as the first moved one) from its repository address; it works on the devices and keeps working with the internet off.
- An update shows with its new permissions, is installed only after confirming, and can be rolled back.
- An unknown publisher shows the warning, and a member who is not admin cannot install.
- A new band has the preinstalled set without internet.
