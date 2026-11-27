# Architektur-Spezifikation: Band-Management & Live-Prompter

## 1. Systemübersicht (Local-First, Microkernel & Plugin-Architektur)
Das System ist ein hochgradig erweiterbares, GitHub-basiertes Open-Source-Ökosystem. Die absolute Grundphilosophie lautet "Local-First": Die App funktioniert im Kern komplett offline auf einem Tablet. Das System basiert auf einer schlanken "Core"-Engine (Microkernel). Alle weiteren Funktionen (Hardware-Support, Cloud-Sync, Backups) werden als Plugins (Module/Adapter) aus separaten GitHub-Repositories dynamisch hinzugeladen, sodass jede Band ihr System nach ihren Hardware-Möglichkeiten individuell zusammenstellen kann.

* **Plugin-Verteilung über den Mesh:** Installierte Plugins sind selbst replizierte Dokumente. Wird ein Plugin auf einem Tablet installiert, verteilt die Replikation die Installation an alle anderen Tablets *und* an den Host, der die passende Server-Implementierung daraufhin startet oder stoppt. Es gibt keinen zweiten Transportweg neben der Replikation. Das Nachladen des Plugin-*Codes* aus einem GitHub-Repository ist der nächste Ausbauschritt — heute verteilt sich das Manifest (Name, Version, Capabilities, aktiviert ja/nein).
* **Zwei Arten von Add-ons (Marco, 2026-11-10):** Standard ist ein **JS-Add-on**, das auf jedem Host gleich läuft, abgeschottet in einem Worker und nur mit den Rechten, die es anmeldet. Was eine Bibliothek in einer anderen Sprache braucht (YouTube, Demucs, Piper), bekommt je Plattform ein **eigenes Hilfsprogramm** – auf dem Laptop ein Programm, auf Android ein eigenes App-Paket – nie nachgeladener nativer Code in StageBoard selbst. Ziel: Add-ons auch von anderen Leuten, von einer Community gepflegt; die App wird ohne Add-ons Dritter ausgeliefert. Die Schnittstelle für Add-on-Entwickler: [docs/32](32_Add-on_Schnittstelle.md).
* **Multi-Tenant fähig (Workspaces):** Ein Musiker kann in mehreren Bands spielen. Die Daten (Songs, Settings, Profile) sind pro Band strikt isoliert. Der Wechsel erfolgt simpel in der PWA via Dropdown. Die Cloud ist komplett optional.

## 2. Komponenten im Detail

### 2.1 Tablet-Clients (PWA) - Die Basis
* **Datenhaltung:** PouchDB speichert das gesamte Repertoire offline.
* **Input Control Engine:** Verarbeitet W3C Keyboard-Events von Bluetooth-/Kabel-Fußtastern (Frei belegbar für Page-Turn, Start/Stop, Ad-Hoc Show Cues).
* **Live-Prompter Rendering-Engine (Dual Mode):**
  * **Smooth Scroll:** Stufenloser, kriechender Teleprompter-Modus.
  * **Paginated View:** Statische Seitenansicht.
  * **Smart Track:** Beide Modi nutzen den eingehenden Timecode für Automated Page-Turns und Section Highlighting (der aktuell zu spielende Song-Part wird visuell hervorgehoben). Die Ansicht ist strikt nutzerspezifisch (Overlay-Layer).
* **Live-Modus:** Empfängt Timecode, Floating Master-Token Logik, dynamische Live-Queue (Spotify-Prinzip).
* **Modular Musician Toolkit:**
  * Tuner, Key Finder & Preview-Scraper (mit Capo-Detection, Regex-Analyse und manuellem Override-Dropdown).
  * Show Control Editor: WebMIDI-Interface zum Setzen von PC/CC-Befehlen und DMX-Cues.
  * IEM Controller: Fader-Ansicht mit isolierten "My Channels" für die More-Me-Funktion (Nutzer sieht z.B. nur eigenen Gesang/Gitarre + Rest-Band).

### 2.2 Host (Live auf der Bühne)
*Stand 2026-11-20 (#960, #962): der Host ist eine **Rolle**, kein bestimmter Rechner. Jedes Gerät kann ihn übernehmen; was es dabei kann, entscheidet allein seine Leistung (`GET /host/capabilities`). Gesamtbild und Diagramme: docs/34 (Host) und docs/35 (die ganze Software).*
* **Wer ihn sein kann:** ein Laptop oder eine eigene Linux-Kiste (Node mit eigenem kleinen HTTP/2-Listener als Transport) und ein Android-Tablet (dasselbe `sync-host` in der App, mit eigenem Web-Server in `LocalHostPlugin.java`). Der Code des Hosts steht einmal in `packages/sync-host`; die Plattform liefert nur Transport und Speicher.
* **Hardware:** Flexibel (z.B. Dell PC, Raspberry Pi, ein Tablet) + USV (Unterbrechungsfreie Stromversorgung) mit Auto-Shutdown-Daemon für Datensicherheit beim Abbau (Graceful Shutdown), wo ein Laptop oder eine Kiste hostet.
* **Daten-Sync:** Fungiert als lokaler Datenbank-Host (eingebauter Host, `packages/sync-host`, PouchDB über LevelDB bzw. IndexedDB). Logins und PINs sind Dokumente des Bands selbst - kein zweiter Kontenspeicher.
* **Was nur ein Node-Rechner kann** (Jobs, die der Host nur mit der Fähigkeit des Geräts annimmt, sonst `501 capability_missing` mit dem, was fehlt): Backup auf Laufwerk, Stem-Trennung, Sprachausgabe, YouTube-Download per yt-dlp, Chord-Suche, OSC-Eingang, MIDI am Host. Das Tablet meldet das als "noch nicht gebaut" mit einer Erklärung, warum es langsam wäre und wie man es verbessert; YouTube läuft auf dem Tablet selbst über den Android-Helfer.
* **Flexible Audio-Routing-Matrix:**
  * Internal Soundcard / Stereo Klinke (Fallback).
  * Multichannel USB-Audio-Interface (Flexibles Routing von Playback, Click, Cue an analoge Ausgänge).
  * Direct-to-Mixer (USB Stream ins digitale Pult).
* **Hardware Profile & Channel Locking (MIDI):** Strikte Zuweisung von festen MIDI-Kanälen pro Musiker-Profil.
* **Show Control Gateway (via Plugins):**
  * Mixer: OSC/WebSocket-Steuerung für digitale Pulte (Soundcraft UI24R, Allen & Heath CQ18T). Location-Profile ermöglichen schnellen Pult-Wechsel.
  * Lighting: Sendet Timecode- und Ad-Hoc-Cues an QLC+ oder Maestro DMX (als virtuelles Instrument gemappt).
* **System Health Monitor:** Cockpit-Dashboard (Ampelsystem für Ping/Heartbeat-Checks zu allen Geräten inkl. Mischpulten).
* **Backup-Daemon:** Zieht automatisiert Backups auf USB oder externe Speicher (NAS/Cloud) per Plugin.

### 2.3 High Availability & Redundanz (Das "Touring"-Setup)
*Gebaut ist **nicht** der ursprünglich geplante Active-Active-Betrieb mit virtueller IP, sondern ein Primär-/Backup-Paar (docs/25 §6e, #782).*
* **Primär und ein passives Backup:** Das Band listet bis zu zwei Hosts (`band-settings:band`, `hosts`). Das Backup kennt den Primär über ein signiertes Lease, das dieser regelmäßig sendet, und kopiert dessen Daten. Es beantwortet in dieser Zeit nur, wer es ist, das Lease und seine Fähigkeiten, und lehnt die Banddaten mit 503 ab.
* **Übernahme:** Bleibt das Lease etwa 5 s aus und antwortet der Primär auch direkt nicht, übernimmt das Backup. Die **Epoche** steigt; die Geräte folgen dem Host mit der höchsten Epoche (`useHostFollower`). Die Bandzeit des Primärs wird über einen gemessenen Versatz weitergeführt, damit der Takt nicht springt.
* **Rückgabe:** Ein zurückgekehrter Primär gibt erst zurück, wenn das Backup 30 s lückenlos geantwortet hat und seine Kopie der Zwischenzeit abgeglichen ist; während eines laufenden Songs nie.
* **Nicht gebaut:** virtuelle IP/Keepalived, ein Redundanz-Plugin und das Umschalten von Audio-/MIDI-Hardware (rtpMIDI/Dante-Master, Radial SW8). Die Geräte wechseln stattdessen ihre Host-Adresse selbst. Ob das auf der Bühne reicht, ist nicht gemessen (docs/25 §6e: nur die Übernahmezeit).

### 2.4 Self-Hosted Cloud & AI (Vorbereitung / Optional)
* **Sicherheit:** Plugins für Cloud-Storage (AWS S3, Google Drive, Dropbox) für vollautomatische Off-Site-Backups.
* **Hybride KI-Pipeline (6 Stems):** Client-Side WebGPU-Berechnung (schnell, schont Server) mit Fallback auf asynchrone Server-Warteschlange (für schwache Endgeräte).
* **Tone Match (IR) Engine:** DSP-Microservice für EQ-Matching zur Generierung von Impulse Responses (.wav).