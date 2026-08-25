# Architektur-Spezifikation: Band-Management & Live-Prompter

## 1. Systemübersicht (Local-First, Microkernel & Plugin-Architektur)
Das System ist ein hochgradig erweiterbares, GitHub-basiertes Open-Source-Ökosystem. Die absolute Grundphilosophie lautet "Local-First": Die App funktioniert im Kern komplett offline auf einem Tablet. Das System basiert auf einer schlanken "Core"-Engine (Microkernel). Alle weiteren Funktionen (Hardware-Support, Cloud-Sync, Backups) werden als Plugins (Module/Adapter) aus separaten GitHub-Repositories dynamisch hinzugeladen, sodass jede Band ihr System nach ihren Hardware-Möglichkeiten individuell zusammenstellen kann.

* **Plugin-Verteilung über den Mesh:** Installierte Plugins sind selbst replizierte Dokumente. Wird ein Plugin auf einem Tablet installiert, verteilt CouchDB die Installation an alle anderen Tablets *und* an den Stage-Server, der die passende Server-Implementierung daraufhin startet oder stoppt. Es gibt keinen zweiten Transportweg neben der Replikation. Das Nachladen des Plugin-*Codes* aus einem GitHub-Repository ist der nächste Ausbauschritt — heute verteilt sich das Manifest (Name, Version, Capabilities, aktiviert ja/nein).
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

### 2.2 Stage-Server (Live auf der Bühne)
* **Hardware:** Flexibel (z.B. Dell PC, Raspberry Pi) + USV (Unterbrechungsfreie Stromversorgung) mit Auto-Shutdown-Daemon für Datensicherheit beim Abbau (Graceful Shutdown).
* **Daten-Sync:** Fungiert als lokaler CouchDB-Node.
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
* **Active-Active Datenbank:** Zwei Stage-Server (A-Rig und B-Rig) synchronisieren sich via CouchDB in Echtzeit.
* **Virtual IP / Load Balancing:** Ein "Redundanz-Plugin" (z.B. basierend auf Keepalived) stellt eine virtuelle IP-Adresse (VIP) im Bühnen-WLAN bereit. Fällt Server A aus, übernimmt Server B die IP. Die PWA der Tablets verliert keine Verbindung.
* **I/O Failover:** Bei Umschaltung sendet das Redundanz-Plugin Trigger-Signale für Audio/MIDI-Hardware (z.B. Wechsel des rtpMIDI/Dante-Masters oder Schaltsignal an analoge Auto-Switcher wie Radial SW8).

### 2.4 Self-Hosted Cloud & AI (Vorbereitung / Optional)
* **Sicherheit:** Plugins für Cloud-Storage (AWS S3, Google Drive, Dropbox) für vollautomatische Off-Site-Backups.
* **Hybride KI-Pipeline (6 Stems):** Client-Side WebGPU-Berechnung (schnell, schont Server) mit Fallback auf asynchrone Server-Warteschlange (für schwache Endgeräte).
* **Tone Match (IR) Engine:** DSP-Microservice für EQ-Matching zur Generierung von Impulse Responses (.wav).