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

## Phase 6: Touring-Features (Ab Woche 6 / Community-Phase)
Das Ziel: Absicherung und Ausbau für große Gigs.

* **Schritt 1:** Das Backup-Plugin.
* **Schritt 2:** Das "Venue Profile" (Graceful Degradation von UI-Widgets).
* **Schritt 3 (Optional):** Erster Architektur-Test für das Redundanz-Plugin (Virtual IP / B-Rig).
* **Schritt 4:** Community-Plugins (Mischpult-Adapter, DMX-Licht).