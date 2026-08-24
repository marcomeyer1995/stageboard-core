# Meilensteinplan & Roadmap (StageBoard)

Dieser Plan definiert die groben Entwicklungsphasen von StageBoard. Er ist so strukturiert, dass nach jedem Meilenstein ein funktionsfähiges, testbares Inkrement entsteht. Wir entwickeln strikt nach dem Prinzip: Core First, UI Second, Plugins Third.

## Phase 1: Das Fundament & "Offline-First" (Woche 1) — ✅ Abgeschlossen
Das Ziel: Eine rudimentäre Web-App (PWA), die lokal Daten speichert, und ein leeres Monorepo.

* **Schritt 1:** Monorepo-Setup (`stageboard-core`). ✅
* **Schritt 2:** PouchDB Integration im Frontend (Lokales Speichern von Dummy-Songs). ✅
* **Schritt 3:** Das Basis-UI. Implementierung des "Widget-Grids" mit Tailwind CSS (leere Kacheln) und dem Dark/Light-Mode Toggle. ✅ Dark Mode als Standard steht; der eigentliche Toggle (Light Mode, siehe [docs/07](07_UI_Konzept.md)) fehlt noch — kein Blocker für spätere Phasen, aber offen.
* **Meilenstein-Test:** ✅ Du kannst die PWA ohne Internetverbindung öffnen, einen Song anlegen, die App neu laden und der Song ist noch da.

## Phase 2: Der "Song-Studio" Editor & ChordPro (Woche 2) — ✅ Abgeschlossen
Das Ziel: Texte und Akkorde eingeben und anzeigen lassen.

* **Schritt 1:** Implementierung des ChordPro-Parsers (Wandelt `[G]` Text in visuelle Akkorde um). ✅
* **Schritt 2:** Der Sheet Editor und die simple Text-Ansicht (Prompter Widget). ✅
* **Schritt 3:** Zod-Validierung im Backend für das "Song-Schema", erste CouchDB-Instanz hochfahren und Sync zwischen Tablet (PouchDB) und Server (CouchDB) herstellen. ✅ (Sync läuft direkt PouchDB↔CouchDB, ohne Fastify als Zwischenschicht; Setup per `scripts/setup-couchdb.sh`.)
* **Meilenstein-Test:** ✅ Du tippst auf Tablet A einen Songtext ein, und er taucht wenige Sekunden später automatisch auf Tablet B auf. (Verifiziert mit zwei isolierten Browser-Kontexten gegen dieselbe CouchDB.)

## Phase 3: Timecode & Live-Engine (Woche 3)
Das Ziel: StageBoard bekommt ein Zeitgefühl.

* **Schritt 1:** Die Master-Clock. Implementierung eines globalen Timecodes über Zustand (State Management).
* **Schritt 2:** Das "Tap-to-Sync" Plugin für den Editor.
* **Schritt 3:** Die Dual-Prompter-Ansicht: Umsetzung von "Smooth Scroll" und "Paginated View".
* **Meilenstein-Test:** Du startest die Uhr, und der Text auf dem Tablet scrollt oder blättert völlig automatisch im richtigen Moment um.

## Phase 4: Microkernel & Das erste Plugin (Woche 4)
Das Ziel: Die Brücke zur echten Hardware (Bühne).

* **Schritt 1:** Definition des `IPlugin` Interfaces im `shared-types` Workspace. ✅ Bereits vorgezogen in Phase 1 erledigt (`packages/shared-types/src/plugin.ts`), da es zusammen mit dem Song-Schema entstand. Noch offen: der eigentliche Plugin-Loader/Show Control Gateway (Schritt 2).
* **Schritt 2:** Das "Show Control Gateway" im Fastify-Backend bauen.
* **Schritt 3:** Entwicklung des Plugins: "Generic WebMIDI Input".
* **Meilenstein-Test:** Du trittst auf einen Fußtaster, und das Prompter-Widget springt zur nächsten Song-Sektion.

## Phase 5: Multi-Tenant & Setlists (Woche 5)
Das Ziel: Band-Management und Gig-Vorbereitung.

* **Schritt 1:** Einführung der "Workspaces" (Band A vs. Band B).
* **Schritt 2:** Setlist-Logik.
* **Schritt 3:** Das "Master-Token" System.
* **Meilenstein-Test:** Der Sänger drückt auf "Nächster Song" und das Tablet des Drummers wechselt synchron mit.

## Phase 6: Touring-Features (Ab Woche 6 / Community-Phase)
Das Ziel: Absicherung und Ausbau für große Gigs.

* **Schritt 1:** Das Backup-Plugin.
* **Schritt 2:** Das "Venue Profile" (Graceful Degradation von UI-Widgets).
* **Schritt 3 (Optional):** Erster Architektur-Test für das Redundanz-Plugin (Virtual IP / B-Rig).
* **Schritt 4:** Community-Plugins (Mischpult-Adapter, DMX-Licht).