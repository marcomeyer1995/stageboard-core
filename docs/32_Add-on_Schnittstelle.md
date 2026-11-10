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

## 6. Server-Teil – *nur eingebaut*

**Gebaut** (nur für StageBoards eigene Add-ons): Server-Add-ons implementieren `IShowControlPlugin` (`init(context)`, `trigger(event)`, `shutdown()`), der Host startet und stoppt sie, wenn ihr Dokument erscheint oder verschwindet, und meldet ihren Zustand. Welche es gibt, steht fest im Code (`core-backend/src/plugins/catalog.ts`).

**Geplant:** Server-Code aus `source` nachladen, **jedes Add-on in einem eigenen Node-Prozess** mit Nodes Permission-Modell (`--permission`, nur erlaubte Verzeichnisse und kein Starten von Programmen außer den angemeldeten Hilfsprogrammen) – dieselben Nachrichten wie §4 über eine Pipe. Auf einem Android-Host läuft derselbe JS-Teil in der App (Worker), Hilfsprogramme dort als App-Paket (§8).

Lange Aufgaben (Stems trennen, Download) laufen als **Job**: ein Band-Dokument mit Status und Fortschritt (`asyncJob.ts`), das jedes Gerät sieht. *Gebaut* für die eingebauten Jobs; *geplant*: Jobs für Add-ons über dieselben Nachrichten (`job-progress`, `job-result`).

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

**Laptop/PC** – *gebaut für die eingebauten*: ein Programm auf dem Host (`yt-dlp`, Python mit Demucs, Piper); der Host meldet je Add-on, ob es da ist (`GET /server/capabilities`).

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

- **Zustand** (`pluginHealth.ts`): `online` / `offline` / `error` + Meldung; vom Host für Server-Add-ons, vom Gerät für Geräte-Add-ons. Ohne Meldung seit 15 s gilt es als offline – ein Add-on meldet sich also regelmäßig.
- **Meldungen** an Musiker als Code + Parameter, nicht als fertiger Text: das Gerät übersetzt (docs/03, #679).
- **Einstellungen** der Band in `settings`, repliziert; das Add-on prüft sie mit einem eigenen Schema und nimmt bei Unbekanntem seine Voreinstellung (nie abstürzen).

## 10. Versionen – *gebaut* (#756)

`apiVersion` ist die Version dieser Schnittstelle (`ADDON_API_VERSION`, heute 1; ein Manifest ohne Angabe gilt als 1). Kleine Erweiterungen bleiben rückwärtsverträglich; bricht etwas, steigt sie, und StageBoard lädt ein Add-on mit zu alter oder zu neuer Version nicht, sondern zeigt es im Add-on-Tab (und später auf der Karte) als „passt nicht zu dieser StageBoard-Version“ – der Host über den Zustand `error` mit dem Code `plugin.apiVersion`, das Gerät für seine eigenen Add-ons genauso.

## 11. Die eingebauten Add-ons – Umbau (Marco, 2026-11-10: „die anderen Pakete bauen wir entsprechend um“)

| Heute eingebaut | wird | Hilfsprogramm |
|---|---|---|
| Kemper, MG-30, RC-500, CQ-18T, Ui24R (Translatoren in `stage-pwa/src/lib/*Translator.ts`), MIDI-Clock | JS-Add-on | – |
| OSC (`oscPlugin.ts`) | JS-Add-on (Server-Teil, Recht `osc:`) | – |
| Sprachausgabe Piper | JS-Add-on | Laptop: Piper; Android: offen |
| Stem-Trennung | JS-Add-on | Laptop: Python + Demucs; Android: offen (zu schwer?) |
| Ultimate-Guitar-Import (Chrome über puppeteer) | JS-Add-on | Laptop: Chrome; Android: offen |
| YouTube-Download | JS-Add-on | Laptop: `yt-dlp`; Android: App-Paket mit NewPipeExtractor (zuerst) |

Reihenfolge: erst das YouTube-Hilfsprogramm für Android (prüft §8 an einem echten Fall), dann die Sandbox (§4/§6) mit einem Geräte-Translator als erstem Umzug, dann die übrigen.
