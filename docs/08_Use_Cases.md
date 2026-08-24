# Analyse der Use Cases & Workflows

Um Lücken in der Architektur zu finden, betrachten wir den kompletten Lifecycle eines Gigs.
Wichtig: Das System ist Local-First und Modular (Core + Plugin) designt.

## Phase 0: System-Setup & Mandanten-Logik

### Use Case 0.1: Multi-Band Management (Der Workspace-Switch)
* Ein Musiker wählt in der PWA einfach "Band A" oder "Band B" aus (oder installiert separate PWAs). Die Daten (Songs, Settings, Hardware-Profile) sind strikt isoliert.
* **Hardware-Eskalation & Plugins:** Die Band lädt sich aus den Community-Repos nur die Plugins, die sie wirklich braucht (z.B. nur "Soundcraft UI24R Adapter", kein "DMX-Licht").

## Phase 1: Die Vorbereitung (Daten-Import & Setlist)

### Use Case 1.1: Smarter In-App Tab Import (Der Scraper)
* User sucht in der App nach Tabs. Der Search-Proxy im Backend holt die Ergebnisse. Der User verlässt die App nie.
* **Preview, Key-Detection & Capo-Intelligence:** Ein Overlay zeigt den Text und analysiert die Akkorde. Findet es ein "Capo 2", schlägt die App vor, das Sheet auf die klingende Tonart zu transponieren.
* **Manueller Fallback:** Falls der Regex-Scanner eine komische Syntax nicht erkennt, kann der User über ein Dropdown (Notierte vs. Klingende Tonart) manuell eingreifen.

### Use Case 1.2: Setlist kopieren & anpassen (Der Standard-Workflow)
* Der User dupliziert die Setlist des letzten Gigs als neues Template, fügt neue Songs ein und speichert sie unter neuem Datum ab. Der Default-Übergang für jeden neuen Song ist "Manual" (Safety First).

## Phase 2: Individuelles Üben (Offline / Mesh)

### Use Case 2.1: MIDI Show Control Setup (WebMIDI)
* Der Gitarrist nutzt WebMIDI, um Marker in der Timeline zu setzen (z.B. Kemper CC-Befehle). Dank "Channel Locking" (Kanal 1 ist in seinem Profil hart codiert) kann er nicht versehentlich den Synthesizer umprogrammieren.

### Use Case 2.2: Tone Match (IR-Generierung für Gitarristen)
* Der Gitarrist spielt ein Signal ins Tablet. Das Tool vergleicht es mit der isolierten KI-Gitarren-Spur (aus der hybriden KI-Pipeline) und generiert eine `.wav` IR-Datei für das Effektgerät.

## Phase 3: Setup beim Gig (Stage Server & Local Mesh)

### Use Case 3.1: Venue / Hardware Profiling & System Check
* Der Bandleader wählt "Location: Club X (Allen & Heath CQ18T)". Das Gateway lädt das Plugin.
* Das Cockpit-Dashboard zeigt Ampeln (Heartbeat-Pings) für Pult, Maestro DMX, Tablets.
* Die Hardware-Taster (AirTurn etc.) werden verifiziert (Page Turn, Next Song, Ad-Hoc Cues).

## Phase 4: Live auf der Bühne (Die Show)

### Use Case 4.1: Der automatische Gig & Audio/MIDI-Routing
* **Audio:** Der PC routet das Playback flexibel ins Netz/USB oder Klinke.
* **MIDI/Licht:** Der Server feuert programmierte Cues an Instrumente und Lichtpulte.

### Use Case 4.2: Individuelle Text-Ansicht (Scroll vs. Pagination)
* Der Sänger hat im User-Profil "Paginated View" gewählt. Das Tablet nutzt den Timecode des Stage-Servers, hebt den aktuellen Refrain visuell hervor (Section Highlighting) und blättert im exakt richtigen Moment automatisch zur nächsten Seite. Der Gitarrist nutzt hingegen den "Smooth Scroll".

### Use Case 4.3: Dynamische Live-Queue & Encore (Spontane Änderungen)
* Ruft das Publikum nach einem Encore, nutzt der Inhaber des "Master-Tokens" das Kontextmenü ("Als nächstes spielen"), um die Queue spontan zu überschreiben.

### Use Case 4.4: Granulares "More Me" (IEM Steuerung)
* Der Sänger drückt "More Me". Die UI zeigt nur die Fader für sein Gesangsmikro und die Akustikgitarre (seine Profil-Kanäle) sowie einen Gruppen-Fader für "Band". Das Pult-Gateway setzt dies auf Aux 1 punktgenau um.

### Use Case 4.5: Ad-Hoc Show Cues (Asynchrone Effekte)
* Der Gitarrist drückt einen konfigurierten Fußtaster. Das Signal umgeht die Song-Timeline und triggert sofort einen Blinder-Effekt (via DMX) am Maestro.

### Use Case 4.6: Floating Master Token & Tablet-Absturz
* Stürzt das Master-Tablet ab, drückt ein anderer Musiker "Take Over". Der Token wechselt, die Show läuft weiter.

### Use Case 4.7: Stage-Server Failover (Redundanz-Notfall)
* Der Worst-Case: Das A-Rig fällt aus. Das Redundanz-Plugin auf dem B-Rig bemerkt den Ping-Verlust, übernimmt die Virtuelle IP und schaltet das I/O (Dante/Radial SW8) um. Show läuft ohne Unterbrechung weiter.

## Phase 5: Der Abbau & Nachbereitung

### Use Case 5.1: Graceful Shutdown & Auto-Backup
* Strom wird hart gezogen. Die USV fängt den Ausfall ab, gibt den Shutdown-Befehl an den Stage-Server, dieser zieht per Plugin ein letztes Backup auf den USB-Stick und fährt sicher herunter.

### Use Case 5.2: Post-Gig Report
* Das System generiert aus dem Logfile eine "True Setlist" (inkl. aller spontanen Zugaben) für die GEMA/SUISA-Meldung.