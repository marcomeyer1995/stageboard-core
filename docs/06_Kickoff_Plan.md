# Projekt Kickoff: Tech-Stack & Day 1 Action Plan

Bevor du die erste Zeile Code schreibst (oder von Claude schreiben lässt), müssen die Leitplanken stehen. Hier ist der definierte Tech-Stack und dein konkreter Fahrplan für den ersten Tag von StageBoard.

## 1. Der festgelegte Tech-Stack
Der verbindliche Tech-Stack steht in der [CLAUDE.md](../CLAUDE.md) (Abschnitt "Tech-Stack") — hier nur die Begründung, warum: Ein reines TypeScript-Ökosystem erlaubt es, Typen (Zod-Schemas) zwischen Backend (Core) und Frontend (PWA) nahtlos zu teilen. React (mit Vite) wurde gewählt, weil sich die Widget/Dashboard-Logik (Grid-Layouts) damit am einfachsten als "Bausteine" umsetzen lässt; Fastify statt Express, weil es performanter und latenzärmer für Timecode/Echtzeit-APIs ist; Zustand statt Redux, weil es schlanker ist für Echtzeit-Daten wie Timecode.

### Code-Struktur (Das Monorepo)
* Wir nutzen npm workspaces (oder Turborepo).
* Dadurch liegen das Frontend, das Backend und die ersten Kern-Plugins im selben GitHub-Repository (`stageboard-monorepo`), was es für Claude Code extrem einfach macht, den Gesamtkontext zu verstehen und Schnittstellen (Interfaces) übergreifend anzupassen.

## 2. Wo installiere ich was? (Hardware-Setup)
* **Antwort:** Alles passiert heute ausschließlich auf deinem persönlichen Linux Entwickler-Laptop.
* Kein Cloud-Server.
* Kein Raspberry Pi oder Proxmox.
* **Warum?** Du entwickelst heute den "lokalen Kern". Erst wenn dieser läuft, deployen wir ihn via Docker auf die Bühnen-Hardware.

## 3. Der detaillierte Action-Plan für Tag 1
Hier ist dein konkreter Schritt-für-Schritt-Plan, um StageBoard heute zum Leben zu erwecken.

### Schritt 1: GitHub & Workspace vorbereiten (Manuell)
1. Öffne dein Terminal (Linux).
2. Erstelle den Hauptordner: `mkdir stageboard-core && cd stageboard-core`
3. Erstelle den Docs-Ordner und lege alle Planungs-Dateien ab: `mkdir docs` (Kopiere die Markdown-Dateien dort hinein).
4. Erstelle die `CLAUDE.md` im Hauptverzeichnis.
5. Initialisiere Git: `git init`
6. Initialisiere ein leeres npm-Projekt: `npm init -y`
7. Installiere Claude Code global: `npm install -g @anthropic-ai/claude-code`
8. Authentifiziere dich bei Claude: Führe `claude` aus und folge dem Login.

### Schritt 2: Das Monorepo-Gerüst bauen lassen (mit Claude)
Anstatt Ordner selbst anzulegen, lassen wir Claude das Monorepo aufsetzen.

**Dein Prompt an Claude:**
> "Lies bitte die CLAUDE.md und bestätige mir kurz in 3 Sätzen, dass du den Tech-Stack und die Vision von StageBoard verstanden hast. Initialisiere danach in diesem Verzeichnis ein Monorepo mit npm workspaces. Erstelle zwei Workspaces: 'packages/core-backend' (ein Fastify Node.js Server mit TypeScript) und 'packages/stage-pwa' (eine React App mit Vite, TypeScript und Tailwind CSS). Richte die package.json im Root so ein, dass ich mit 'npm run dev' beide Projekte parallel starten kann. Nutze striktes TypeScript."

### Schritt 3: Die Datenbank & Typen (Shared Library)
Damit Frontend und Backend dieselbe Sprache sprechen, brauchen wir einen gemeinsamen Typen-Ordner.

**Dein Prompt an Claude:**
> "Erstelle einen neuen Workspace 'packages/shared-types'. Definiere dort ein Zod-Schema für einen 'Song' (Titel, BPM, Timecode-Array) und ein 'Plugin-Interface'. Verknüpfe diese Shared-Types als Dependency im Backend und im Frontend. Installiere außerdem PouchDB im Frontend und binde es ein."

### Schritt 4: Das "Hello World" Dashboard (Frontend)
Jetzt bauen wir das erste visuelle Element des UI-Konzepts.

**Dein Prompt an Claude:**
> "Baue in der 'stage-pwa' ein rudimentäres Grid-Layout mit Tailwind, basierend auf einer Widget-Architektur. Es soll einen Dark-Mode als Standard haben. Erstelle zwei Dummy-Widgets: Ein 'Prompter-Widget' (das nur Text anzeigt) und ein 'Next-Song-Widget'. Richte einen Zustand Store ein, der simuliert, welcher Song gerade aktiv ist."

### Schritt 5: Der erste Commit
Wenn alles baut und über localhost aufrufbar ist:

1. Prüfe, ob Claude eine saubere `.gitignore` erstellt hat.
2. Führe aus: `git add .` (oder `git add`, je nachdem was genau du hinzufügen möchtest)
3. Führe aus: `git commit -m "chore: initial monorepo setup with fastify core and react pwa"`
4. Pushe das Repo in dein GitHub Repository.