# Meilensteinplan & Roadmap (StageBoard)

Dieser Plan definiert die groben Entwicklungsphasen von StageBoard. Er ist so strukturiert, dass nach jedem Meilenstein ein funktionsfähiges, testbares Inkrement entsteht. Wir entwickeln strikt nach dem Prinzip: Core First, UI Second, Plugins Third.

## Phase 1: Das Fundament & "Offline-First" (Woche 1) — ✅ Abgeschlossen
Das Ziel: Eine rudimentäre Web-App (PWA), die lokal Daten speichert, und ein leeres Monorepo.

* **Schritt 1:** Monorepo-Setup (`stageboard-core`). ✅
* **Schritt 2:** PouchDB Integration im Frontend (Lokales Speichern von Dummy-Songs). ✅
* **Schritt 3:** Das Basis-UI. Implementierung des "Widget-Grids" mit Tailwind CSS (leere Kacheln) und dem Dark/Light-Mode Toggle. ✅ Dark Mode ist Standard, der Light-Mode-Toggle ist umgesetzt (persistiert in `localStorage`). Die Widgets nutzen dafür keine `dark:`-Varianten, sondern semantische Farb-Tokens (`bg-surface`, `text-ink`, `text-accent`, …) aus CSS-Variablen — Theme-Wechsel ist eine einzige Klasse auf `<html>`.
* **Meilenstein-Test:** ✅ Du kannst die PWA ohne Internetverbindung öffnen, einen Song anlegen, die App neu laden und der Song ist noch da.

## Phase 2: Der "Song-Studio" Editor & ChordPro (Woche 2) — ✅ Abgeschlossen
Das Ziel: Texte und Akkorde eingeben und anzeigen lassen.

* **Schritt 1:** Implementierung des ChordPro-Parsers (Wandelt `[G]` Text in visuelle Akkorde um). ✅
* **Schritt 2:** Der Sheet Editor und die simple Text-Ansicht (Prompter Widget). ✅
* **Schritt 3:** Zod-Validierung im Backend für das "Song-Schema", erste CouchDB-Instanz hochfahren und Sync zwischen Tablet (PouchDB) und Server (CouchDB) herstellen. ✅ (Sync läuft direkt PouchDB↔CouchDB, ohne Fastify als Zwischenschicht; Setup per `scripts/setup-couchdb.sh`.)
* **Meilenstein-Test:** ✅ Du tippst auf Tablet A einen Songtext ein, und er taucht wenige Sekunden später automatisch auf Tablet B auf. (Verifiziert mit zwei isolierten Browser-Kontexten gegen dieselbe CouchDB.)

## Phase 3: Timecode & Live-Engine (Woche 3) — ✅ Abgeschlossen
Das Ziel: StageBoard bekommt ein Zeitgefühl.

* **Schritt 1:** Die Master-Clock. Implementierung eines globalen Timecodes über Zustand (State Management). ✅ (`useClockStore`, reaktiv über `useElapsedMs` per requestAnimationFrame statt globaler Re-Renders)
* **Schritt 2:** Das "Tap-to-Sync" Plugin für den Editor. ✅ (`TapToSync.tsx` im Sheet Editor — Leertaste/Tap-Button schreibt pro Zeile den aktuellen Master-Clock-Timecode)
* **Schritt 3:** Die Dual-Prompter-Ansicht: Umsetzung von "Smooth Scroll" und "Paginated View". ✅ Beide Modi nutzen den Timecode für Section Highlighting. "Song-Parts" (`{part: Chorus}`, siehe [docs/04](04_Editor_Und_Datenstruktur.md)) sind umgesetzt und bilden zugleich die echten Seiten-Grenzen: Paginated View zeigt genau einen Part pro Seite (mit Label und `n/m`-Anzeige) und blättert den ganzen Block um, statt zeilenweise zu scrollen. Songs ohne Parts fallen auf feste Blöcke à 6 Zeilen zurück.
* **Meilenstein-Test:** ✅ Du startest die Uhr, und der Text auf dem Tablet scrollt oder blättert völlig automatisch im richtigen Moment um.

## Phase 4: Microkernel & Das erste Plugin (Woche 4) — ✅ Abgeschlossen
Das Ziel: Die Brücke zur echten Hardware (Bühne).

Komplett ohne physische Hardware gebaut — genau wie [docs/03](03_Developer_Experience.md) es für die KI-gestützte Entwicklung vorsieht (Ports & Adapters + Hardware-Mocks).

* **Schritt 1:** Definition des `IPlugin` Interfaces im `shared-types` Workspace. ✅ Bereits in Phase 1 vorgezogen; jetzt um `IShowControlPlugin` (Zod-validierte `ShowControlEvent`/`ShowControlResult`) ergänzt.
* **Schritt 2:** Das "Show Control Gateway" im Fastify-Backend bauen. ✅ `PluginRegistry` + Mock-Mischpult-Plugin (exakt das `{status:"ok", volume:5}`-Beispiel aus docs/03), Routen `GET /plugins` und `POST /plugins/:name/trigger`.
* **Schritt 3:** Entwicklung des Plugins: "Generic WebMIDI Input". ✅ `webMidi.ts` im Frontend (WebMIDI ist eine Browser-API, kein Backend-Plugin) — Note-On/Program-Change lösen einen Sprung zum nächsten Song-Part aus (`nextSectionIndex`), bzw. zur nächsten Zeile, wenn der Song keine Parts definiert. Kein Gerät angeschlossen ist ein normaler Zustand (Graceful Degradation), kein Fehler; ein "Fußtaster simulieren"-Button deckt den Meilenstein-Test ohne Hardware ab.
* **Meilenstein-Test:** ✅ Du trittst auf einen Fußtaster, und das Prompter-Widget springt zur nächsten Song-Sektion. (Verifiziert per simuliertem Trigger — der Code-Pfad ist identisch zu einem echten MIDI-Fußtaster.)

## Phase 5: Multi-Tenant & Setlists (Woche 5) — ✅ Abgeschlossen
Das Ziel: Band-Management und Gig-Vorbereitung.

* **Schritt 1:** Einführung der "Workspaces" (Band A vs. Band B). ✅ Echte Datenisolation über separate PouchDB-/CouchDB-Datenbanken pro Workspace (`stageboard-<kind>-<workspaceId>`), nicht nur eine gefilterte Ansicht.
* **Schritt 2:** Setlist-Logik. ✅ Anlegen/Duplizieren/Umsortieren, aktive Setlist bestimmt die Song-Reihenfolge der Live-Queue.
* **Schritt 3:** Das "Master-Token" System. ✅ Synchronisiertes Singleton-Dokument (`ShowState`) pro Workspace; Claim/"Take Over" ist einfach ein PUT mit dem zuletzt bekannten `_rev` — CouchDBs übliche Konflikt-Behandlung reicht als "nur ein Gewinner"-Mechanismus, ganz ohne eigene Locking-Logik.
* **Meilenstein-Test:** ✅ Der Sänger drückt auf "Nächster Song" und das Tablet des Drummers wechselt synchron mit. (Verifiziert mit zwei isolierten Browser-Kontexten im selben Workspace.)

## Phase 6: Touring-Features & Ausbau (Ab Woche 6 / Community-Phase)
Das Ziel: Absicherung und Ausbau für große Gigs. Anders als Phase 1–5 ist dies kein linearer Wochenplan mehr, sondern ein nach echten Abhängigkeiten geordneter Issue-Backlog (siehe GitHub) — Stand 2026-09-09, nach Abgleich von [docs/00](00_System_Vision_und_Architektur.md) gegen den Code und den Issue-Tracker. Reihenfolge der Unterphasen ist verbindlich, Reihenfolge *innerhalb* einer Unterphase nicht.

### 6a: Kern-Engine — ✅ im Kern abgeschlossen
Das "Venue Profile" (Graceful Degradation von UI-Widgets) ist umgesetzt als **Capability-Modell** (siehe [docs/07](07_UI_Konzept.md#7-plugins--capabilities-der-vertrag-zwischen-ui-und-hardware)) — Plugins deklarieren Capabilities, Widgets fordern sie an, Heartbeats steuern den Disabled-State. Auch das docs/00 §4–5 beschriebene Fundament der Präzisions-Bühnenausführung, das im Stand 2026-08-31 noch komplett fehlte, existiert jetzt im Code:

* **#31 — NTP-Style Clock Sync:** ✅ Kern erledigt. Burst-Handshake (`clockSync.ts`), `driftMs`-basierter Status statt reiner `jitterMs`-Momentaufnahme, Korrektur für asymmetrische WLAN-Pfade — verifiziert per USB/adb-Ground-Truth-Check und Ende-zu-Ende-MIDI-Test (0–7.5ms Abweichung zwischen Geräten, siehe [docs/09](09_Clock_Sync_Untersuchung.md)). Issue bleibt bewusst offen für den originalen Restumfang: `scheduledAt`-basiertes Ahead-of-Time-Dispatch im `ShowControlGateway`, konsumiert vom Visual-Metronome-Widget (#25).
* **#10 — Logical Devices & Hardware Setup Profiles:** ✅ Kern erledigt. `DeviceRegistry`, `LogicalDevice`-Schema, `HardwareSetup`-Routing (ersetzt das alte `pluginProviding`/`deviceClaims`), echte Client-Runtime-Translatoren statt Mock-Stores, `ShowCue`-Schema plus Ahead-of-Time-Scheduler pro Tablet, dynamisches Plugin-Laden. Restumfang (mehrere gleichzeitige Instanzen derselben Hardware, z.B. zwei Kemper) ist in Folge-Issues gesplittet, siehe unten.

**Organisch aus #10 entstanden und nicht im ursprünglichen Plan, aber komplett ausgeliefert:** die komplette "Plug, Prompt, and Play"-Kette, die docs/00 §5 als Hardware Abstraction Layer & Auto-Binding beschreibt.

* **#100 — Plugin-driven HardwareBinding config:** Slice 1 (bandweite Plugin-Auswahl, geräte-lokale `DeviceTransportConfig`) ausgeliefert. Restumfang (WebMIDI/WebUSB-Erkennung) nach #106 gesplittet.
* **#106 — WebMIDI/WebUSB-Geräteerkennung + Auto-Memory:** ausgeliefert, erweitert um bandweiten, admin-initiierten Discovery Mode und einen geführten Hardware-Setup-Wizard.
* Fünf reale Geräte-Plugins statt Mocks: Kemper Profiler, Allen & Heath CQ-18T, NUX MG-30, BOSS RC-500, Soundcraft Ui24R.
* Device Ledger: Diagnose-Store, Revoke-Endpoint, Ping-Loop, Self-Lock-Guard, UI.
* Fünf Bugfixes an Discovery Mode aus echtem Gebrauch (#133–#138: manuelle Kandidaten-Bestätigung, Re-Binding, verwaiste Rollen-Bindings, Geräte-Neuanlage aus dem Dialog, Schutz vor Rollen-Diebstahl).

**#100 und #106 bleiben als Tracking-Issues offen**, obwohl ihr Kern-Scope erledigt ist — analog zu #31 wäre der sinnvolle nächste Schritt, dort einen Abschluss-Kommentar zu hinterlassen und nur noch den echten Restumfang (Multi-Instanz-Routing) offen zu halten, statt sie unbegrenzt als "offen" zu führen.

* **#129 — Migrate core-backend to HTTP/2** *(neu, 2026-09-08 gefiled)* — behebt eine latente SSE-Connection-Budget-Ceiling. Gehört thematisch zur Kern-Engine-Infrastruktur, war im vorigen Stand dieses Plans noch nicht eingeordnet.

### 6b: Live-Ausführung
Bringt aufgezeichnete/ausgelöste Cues tatsächlich zur Hardware — baut auf 6a auf, das jetzt steht:

* ✅ **#3** — Transition IEM Faders and Lighting Cue Widgets to Live Triggers
* ✅ **#4** — Prevent Song Play Log Loss During Master-Token Handoff
* ✅ **#13** — Differentiate Pause/Stop States in ShowLog
* **#6** — Implement Cue Schema & Manual Cue Recorder UI
* **#7** — Automatic Cue-Detection Assist (baut auf #6 auf)
* **#8** — Live Cue Firing & Post-Show Persistence (baut auf #6/#7 auf)
* **#32** — Implement Master-Token Heartbeat and Force-Override

### 6c: UX- & Live-Feature-Ausbau
Alles, was Musiker im Alltag/auf der Bühne direkt spüren. Einiges hängt an 6a/6b (vermerkt), der Rest ist unabhängig und kann jederzeit eingeschoben werden:

* **#59** — Advanced Transposition & Capo Engine
* **#60** — Multi-User "Ready Check" Pre-Flight Protocol
* **#61** — Smart Rehearsal Looper & Speed Trainer
* **#28** — Dynamic Setlist Time Management / Festival Clock (enthält die gemergte Curfew-Warnung)
* **#26** — Stage Messenger & Flash Alerts (enthält den gemergten timeline-getriggerten `[alert:]`-Teil)
* **#25** — Visual Metronome & Hardware-Routed Click Generator *(Abhängigkeit #10 erledigt — bereit, sobald #31s Ahead-of-Time-Dispatch steht)*
* **#62** — Spatial Stage Layout & Interactive Hardware Matrix *(hängt am Multi-Instanz-Restumfang von #10)*
* **#63** — "Stage Call" IEM Text-to-Speech Announcer *(hängt an #3, erledigt)*
* **#64** — Post-Gig Telemetry & Rehearsal Analytics *(hängt an #13, erledigt)*
* **#23** — Expand Widget Library (Clock, Status, Grouping, Custom Buttons) *(Status-Widget-Abhängigkeit #10 erledigt)*
* **#24** — Musical Reference Widgets (Chord Lookup & Circle of Fifths)
* **#18** — Touch Gestures and Drag-and-Drop for Live Queue
* **#22** — Widget Gallery Overlay & Resize Constraints
* **#35** — Main Menu Dashboard Selector & Sub-Navigation
* **#16** — "Read-Only" Template Dashboards & Edit Protection
* **#14** — Build "Live-Debug-Console" UI
* **#29** — Setlist Transition Notes & Show Flow Items
* **#36** — Define Core vs. Plugin System Boundary & Standard Widgets
* **#57** — Role-Based Access to Widgets & Dashboards *(braucht erst ein Scoping-Gespräch, siehe Issue)*
* ✅ **#58** — Band-Umbenennen (Workspace-Name nicht synchronisiert)
* **#27** — Bluetooth Foot Switch Integration (Keybindings)
* **#15** — Robustness for Ultimate Guitar & MusicBrainz Plugins
* **#17** — Implement Dynamic Plugin Code Loading via Dynamic Imports
* ✅ **#12** — Implement CouchDB Multi-Tenancy & User Roles

**Band-/Server-Topologie** *(neu, noch nicht priorisiert — Issues #70/#84/#85, alle nach dem Stand 2026-08-31 gefiled)*:

* **#84** — Support a Band Whose Stage-Server Differs From This Device's Other Bands
* **#85** — Configurable Master-Token Mode (Gerätespezifisch / Accountspezifisch)
* **#70** — Stage-Server-local CLI script for admin account recovery (break-glass)

### 6d: Touring, Cloud & optionale Plugins
Größter Hardware-/Infra-Aufwand, entsprechend zuletzt:

* Das Backup-Plugin.
* Erster Architektur-Test für das Redundanz-Plugin (Virtual IP / B-Rig, docs/00 §Stage Mesh / docs/01 §2.3).
* Community-Plugins (Mischpult-Adapter, DMX-Licht).
* **#9** — Stem Separation Pipeline
* **#5** — Implement Async-Job Infrastructure & YouTube Extraction
* **#66** — Tone Match (IR) Engine *(hängt an #9)*
* **#65** — Audience QR "Live Jukebox" & Request Relay *(optionales Plugin — bewusste, dokumentierte Ausnahme vom Local-First-Prinzip, siehe Issue)*

### Laufende Bugs
Unabhängig von der Phasen-Reihenfolge, sobald wie möglich beheben:

* Aktuell keine offenen, phasenunabhängigen Bugs bekannt. (#44, Infinite Re-render Loop in Dashboard Grid Layout, ist behoben und durch einen Regressionstest abgesichert.)