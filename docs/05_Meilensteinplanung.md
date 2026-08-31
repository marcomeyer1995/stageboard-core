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
Das Ziel: Absicherung und Ausbau für große Gigs. Anders als Phase 1–5 ist dies kein linearer Wochenplan mehr, sondern ein nach echten Abhängigkeiten geordneter Issue-Backlog (siehe GitHub) — Stand 2026-08-31, nach Abgleich von [docs/00](00_System_Vision_und_Architektur.md) gegen den Code und den Issue-Tracker. Reihenfolge der Unterphasen ist verbindlich, Reihenfolge *innerhalb* einer Unterphase nicht.

### 6a: Kern-Engine (höchste Priorität)
Schließt die größte Lücke zwischen [docs/00](00_System_Vision_und_Architektur.md) und dem tatsächlichen Code: Das "Venue Profile" (Graceful Degradation von UI-Widgets) ist bereits ✅ umgesetzt als **Capability-Modell** (siehe [docs/07](07_UI_Konzept.md#7-plugins--capabilities-der-vertrag-zwischen-ui-und-hardware)) — Plugins deklarieren Capabilities, Widgets fordern sie an, Heartbeats steuern den Disabled-State. Was fehlt, ist das, was docs/00 §4–5 als Fundament der Präzisions-Bühnenausführung beschreibt, bisher aber nirgends im Code existiert:

* **#31 — NTP-Style Clock Sync:** Der "Burst-Handshake" und die Ahead-of-Time-Dispatch-Logik aus docs/00 §4. Der heutige `useClockStore` ist eine rein lokale Uhr pro Gerät, kein netzwerksynchronisierter Master-Clock.
* **#10 — Logical Devices & Hardware Setup Profiles:** Die HAL/Auto-Binding-Schicht aus docs/00 §5. `pluginProviding` greift heute einfach zum ersten Plugin mit passender Capability — keine benannten Logical Devices, keine Hardware-Setup-Profile, kein Routing pro Gerät.

Beide sind Voraussetzung für mehrere Punkte in 6c (u.a. #25, #23, #62) — deshalb zuerst.

### 6b: Live-Ausführung
Bringt aufgezeichnete/ausgelöste Cues tatsächlich zur Hardware — baut auf 6a auf, kann aber parallel begonnen werden, wo kein HAL-Routing nötig ist:

* **#3** — Transition IEM Faders and Lighting Cue Widgets to Live Triggers
* **#6** — Implement Cue Schema & Manual Cue Recorder UI
* **#7** — Automatic Cue-Detection Assist (baut auf #6 auf)
* **#8** — Live Cue Firing & Post-Show Persistence (baut auf #6/#7 auf)
* **#13** — Differentiate Pause/Stop States in ShowLog
* **#32** — Implement Master-Token Heartbeat and Force-Override
* **#4** — Prevent Song Play Log Loss During Master-Token Handoff

### 6c: UX- & Live-Feature-Ausbau
Alles, was Musiker im Alltag/auf der Bühne direkt spüren. Einiges hängt an 6a/6b (vermerkt), der Rest ist unabhängig und kann jederzeit eingeschoben werden:

* **#59** — Advanced Transposition & Capo Engine
* **#60** — Multi-User "Ready Check" Pre-Flight Protocol
* **#61** — Smart Rehearsal Looper & Speed Trainer
* **#28** — Dynamic Setlist Time Management / Festival Clock (enthält die gemergte Curfew-Warnung)
* **#26** — Stage Messenger & Flash Alerts (enthält den gemergten timeline-getriggerten `[alert:]`-Teil)
* **#25** — Visual Metronome & Hardware-Routed Click Generator *(hängt an #10)*
* **#62** — Spatial Stage Layout & Interactive Hardware Matrix *(hängt an #10)*
* **#63** — "Stage Call" IEM Text-to-Speech Announcer *(hängt an #3)*
* **#64** — Post-Gig Telemetry & Rehearsal Analytics *(hängt an #13)*
* **#23** — Expand Widget Library (Clock, Status, Grouping, Custom Buttons) *(Status-Widget hängt an #10)*
* **#24** — Musical Reference Widgets (Chord Lookup & Circle of Fifths)
* **#18** — Touch Gestures and Drag-and-Drop for Live Queue
* **#22** — Widget Gallery Overlay & Resize Constraints
* **#35** — Main Menu Dashboard Selector & Sub-Navigation
* **#16** — "Read-Only" Template Dashboards & Edit Protection
* **#14** — Build "Live-Debug-Console" UI
* **#29** — Setlist Transition Notes & Show Flow Items
* **#36** — Define Core vs. Plugin System Boundary & Standard Widgets
* **#57** — Role-Based Access to Widgets & Dashboards *(braucht erst ein Scoping-Gespräch, siehe Issue)*
* **#58** — Band-Umbenennen (Workspace-Name nicht synchronisiert)
* **#27** — Bluetooth Foot Switch Integration (Keybindings)
* **#15** — Robustness for Ultimate Guitar & MusicBrainz Plugins
* **#17** — Implement Dynamic Plugin Code Loading via Dynamic Imports
* **#12** — Implement CouchDB Multi-Tenancy & User Roles

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

* **#44** — Fix Infinite Re-render Loop in Dashboard Grid Layout