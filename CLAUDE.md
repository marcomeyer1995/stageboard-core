# StageBoard - KI System Prompt & Projektkontext

## Projektvision
StageBoard ist ein modulares All-in-One Live-Betriebssystem für Bands. Es synchronisiert Setlisten, Akkorde, In-Ear-Monitoring (IEM), MIDI-Cues und Lichtsteuerung über ein lokales Mesh-Netzwerk auf der Bühne. Es ist inspiriert vom modularen Dashboard-Ansatz von "Home Assistant".

## Kern-Prinzipien
1. **Local-First & Ausfallsicherheit:** Der Stage-Server (Linux/Docker) ist das Herzstück. Die Tablets der Musiker kommunizieren offline über das lokale Netz.
2. **Graceful Degradation:** Wenn Hardware (z.B. ein Mischpult) fehlt, stürzt das UI nicht ab. Widgets gehen in einen sicheren "Disabled State", damit das Muskelgedächtnis der Musiker nicht gestört wird.
3. **Progressive Disclosure:** Das Standard-UI ist "idiotensicher". Komplexe Einstellungen sind hinter einem "Edit Mode" (Vorhängeschloss-Icon) gesperrt.

## Tech-Stack
Dies ist die einzige verbindliche Quelle für den Tech-Stack (nicht in einzelnen docs/-Dateien duplizieren, dort nur darauf verweisen).

*   **Architektur:** Monorepo (NPM Workspaces oder Turborepo)
*   **Frontend:** React, Vite, TypeScript (100% strict), Tailwind CSS, Zustand (State Management), PouchDB (lokale Datenbank)
*   **Backend:** Node.js, Fastify, TypeScript, Zod (Schema-Validierung, Microkernel-Architektur für Plugins)
*   **Datenbank:** CouchDB (Docker) für Multi-Master-Replikation
*   **Infrastruktur:** Native Ausführung auf Linux (keine Virtualisierung für den Live-Server wegen MIDI/Audio-Latenzen).

⚠️ **Node.js in dieser Dev-Umgebung ist aktuell v18 (EOL seit April 2025).** Deshalb sind einige Pakete bewusst auf ältere, Node-18-kompatible Major-Versionen gepinnt (z.B. Fastify `^4`, Vite `^5`, Vitest `3.2.6`) — nicht ungefragt auf `latest` hochziehen. Details: [docs/03_Developer_Experience.md](docs/03_Developer_Experience.md#0-️-nodejs-version-aktuell-veraltet-node-18).

## Entwicklungsrichtlinien für Claude
*   Schreibe strikt typisierten TypeScript-Code.
*   Nutze einen "Issue-Driven" Ansatz: Kleine, testbare Commits.
*   Logge Fehler im Backend ausführlich (JSON-Logging), um das Debugging zu erleichtern.

## Weiterführende Docs
Die folgenden Dateien in `docs/` enthalten Detailkonzepte. Lies gezielt nur die Datei(en), die zur aktuellen Aufgabe passen — nicht pauschal alle laden.

*   **[docs/01_Architektur_Spezifikation.md](docs/01_Architektur_Spezifikation.md)** — Komponenten im Detail: Tablet-Client, Stage-Server, High-Availability-Setup, Self-Hosted Cloud/KI. → lesen bei Fragen zu Systemaufbau, Plugin-Schnittstellen, Redundanz/Failover.
*   **[docs/02_Ausbaustufen_Konzept.md](docs/02_Ausbaustufen_Konzept.md)** — Hardware-Matrix der 5 Ausbaustufen (Solo bis Touring) mit Feature-Abhängigkeiten. → lesen bei Fragen, ob ein Feature Hardware voraussetzt oder wie Graceful Degradation je Stufe aussieht.
*   **[docs/03_Developer_Experience.md](docs/03_Developer_Experience.md)** — Node.js-Versions-Constraint (siehe oben), Logging-Strategie, Testing/Hardware-Mocks, geplanter interner MCP-Server, Issue-Driven Workflow. → lesen bei Fragen zu Tests, Observability, Dependency-Versionen oder dem KI-Entwicklungsworkflow selbst.
*   **[docs/04_Editor_Und_Datenstruktur.md](docs/04_Editor_Und_Datenstruktur.md)** — ChordPro-Datenmodell, Sheet-Editor, Timecode-Generierung (Tap-to-Sync & Timeline). → lesen bei Arbeit am Song-Editor, Datenschema oder Timecode-Logik.
*   **[docs/05_Meilensteinplanung.md](docs/05_Meilensteinplanung.md)** — Phasenplan Woche 1–6 (Core First, UI Second, Plugins Third). → lesen um einzuordnen, in welcher Ausbauphase sich eine Aufgabe befindet.
*   **[docs/06_Kickoff_Plan.md](docs/06_Kickoff_Plan.md)** — Konkreter Day-1-Actionplan mit Setup-Schritten und Beispiel-Prompts. → lesen beim initialen Monorepo-/Projekt-Setup.
*   **[docs/07_UI_Konzept.md](docs/07_UI_Konzept.md)** — Widget-System, Responsive-Verhalten je Gerätetyp, Edit-Modus, Disabled-State-Verhalten. → lesen bei Arbeit am UI/Layout/Widgets.
*   **[docs/08_Use_Cases.md](docs/08_Use_Cases.md)** — Durchgängiger Gig-Lifecycle als konkrete Use Cases (Setup bis Nachbereitung). → lesen um eine Feature-Anforderung im End-to-End-Kontext zu verstehen.