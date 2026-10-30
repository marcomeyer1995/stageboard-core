# Betriebsstufen: StageBoard ohne festen Stage-Server

Grundidee, Stand 2026-10-28, mit Marco besprochen am 2026-10-27/28. **Noch kein Beschluss** - nur die Richtung; Ausarbeitung folgt später. Ergänzt [docs/02](02_Ausbaustufen_Konzept.md) (Hardware-Matrix) und berührt Kern-Prinzip 1 in CLAUDE.md („Der Stage-Server ist das Herzstück“).

## 1. Warum

Heute braucht eine Band für alles, was mehr als ein Gerät betrifft, einen Stage-Server (Linux, Docker, CouchDB). Für viele Bands ist das eine Hürde vor dem ersten Ausprobieren: zusätzliche Hardware, Einrichtung, Kosten. docs/02 verspricht zwar eine „Stufe 1: Zero Hardware“, aber nur für ein einzelnes Gerät - sobald zwei Musiker gemeinsam spielen wollen, führt kein Weg am Server vorbei.

Ziel: **mit dem anfangen, was die Band schon hat** (Tablets, Handys, ein Laptop), und erst später auf eine eigene Box umsteigen. Das vergrößert die mögliche Nutzerbasis und senkt die Einstiegshürde.

## 2. Grundidee: der Stage-Server wird eine Rolle

Statt „ein bestimmter Rechner“ ist der Stage-Server eine **Rolle („Host“)**, die jedes dafür fähige Gerät übernehmen kann. Der Host meldet, was er kann (Sync, Uhr, Push, Tracks, Plugins); die App zeigt, was auf dieser Stufe fehlt - dieselbe Graceful Degradation wie bei fehlender Hardware heute.

Die Voraussetzung ist schon da: jedes Gerät hält eine vollständige lokale Kopie der Band (PouchDB). Ein Umstieg auf eine höhere Stufe ist deshalb kein Export/Import - die Daten replizieren einfach zum neuen Host.

## 3. Was der Host heute leistet

| Aufgabe | Für einen Gig nötig? |
|---|---|
| Sync-Drehscheibe zwischen den Geräten (CouchDB, `/db`-Proxy) | ja |
| Uhr-Referenz für den Clock-Sync (`/time`) | ja |
| Schneller Push von Show-State, Schaltern, Blitzen (SSE) | ja |
| Backing-Tracks speichern und verteilen (`/audio`) | ja |
| HTTPS (Secure Context, Zertifikat-Pinning der App) | ja für Browser |
| UDP: OSC, mDNS-Erkennung | nur mit OSC/Licht |
| Schwere Add-ons: Demucs, Piper, UG-/YouTube-Import, Backup, App-Updates, Mikrofon-Kalibrierung | nein |

Ein minimaler Host braucht nur die ersten vier Zeilen.

## 4. Drei Stufen

| Stufe | Aufbau | Was geht |
|---|---|---|
| **1 Solo** | ein Gerät, kein Host | Alles für eine Person: Solo Üben, Prompter, Track, Klick, Ansagen, MIDI am Gerät. **Geht heute** (Home-Sandbox). |
| **2 Band-Host** | ein Gerät der Band ist zugleich Host (Laptop, Windows-Tablet, später Android) | Mehrere Geräte synchron: gemeinsame Show, Master, Uhr, Blitze, Tracks verteilt, Nachbericht. Netz: WLAN vor Ort oder Hotspot des Hosts. Ohne die schweren Add-ons. |
| **3 Stage-Server** | eigene Box (wie heute) | Alles, dazu die schweren Add-ons und später Redundanz (docs/02 Stufe 5). |

Wie sich das mit den fünf Hardware-Stufen aus docs/02 zusammenfügt, ist offen (§8).

## 5. Plattformen

| | Als Spieler (Client) | Als Host |
|---|---|---|
| **Windows / Mac** (Laptop, Surface) | sehr gut: Chrome/Edge mit WebMIDI | **sehr gut**: der vorhandene Server läuft nativ auf Node; braucht einen Installer statt Linux/Docker |
| **Android** | sehr gut (eigene App) | **möglich, Spike nötig**: Node in der App (Projekte dafür gibt es, Pflegezustand prüfen) oder kleiner nativer Server; Vordergrund-Dienst gegen das Beenden durch Android; Hotspot |
| **iPad** | **eingeschränkt**: Safari hat kein WebMIDI (keine Pedale/MIDI-Cues), strengere Audio-Regeln, Speicher kann geräumt werden; richtig gut nur mit eigener iOS-App | **kaum**: kein Node, Server höchstens solange die App im Vordergrund ist, eigene iOS-App nötig (Mac, Apple-Konto) |

## 6. Technische Bausteine

1. **CouchDB wird optional.** Das Replikationsprotokoll kann auch PouchDB in Node bedienen (kein Docker). Damit läuft der volle Server auf Windows/Mac als normales Programm, mit demselben Code, und ist Grundlage für einen Android-Host. Der Stage-Server darf bei CouchDB bleiben.
2. **Host meldet seine Fähigkeiten**, die App zeigt fehlende Add-ons statt Fehlern.
3. **Zertifikate je Host**: die Android-App pinnt heute das Zertifikat des einen Stage-Servers; mit wechselndem Host braucht es eine Kopplung beim Beitreten (z. B. QR-Code).
4. **Netz ohne Router**: Hotspot des Host-Geräts; Erkennung über mDNS oder die Adresse aus dem QR-Code.

## 7. Vorgeschlagene Reihenfolge

1. Dieses Konzept ausarbeiten und docs/02 auf die Stufen umstellen (Entscheidung zu Kern-Prinzip 1).
2. Server mit PouchDB statt CouchDB als Option + Installer für Windows/Mac → Stufe 2 auf Laptops und Windows-Tablets. Größter Gewinn für den kleinsten Aufwand; viele Bands haben schon einen Laptop.
3. Spike „Android als Host“: Sync + Uhr + Push für 3-4 Geräte über den eigenen Hotspot, gemessen wie beim Clock-Sync (docs/09).
4. iPad vorerst nur als Client mit klar benannten Grenzen; eine eigene iOS-App hängt an den Store-/Preisfragen aus docs/16.

## 8. Offen

- Ersetzen die drei Betriebsstufen die fünf Stufen aus docs/02, oder liegen sie quer dazu (Betrieb vs. Hardware)?
- Kern-Prinzip 1 in CLAUDE.md neu fassen („der Host ist das Herzstück“)?
- Was passiert, wenn der Host mitten im Gig ausfällt - übernimmt ein anderes Gerät (jedes hat die Daten), und wie wird das bedient?
- Akku und Last: kann ein Host-Tablet gleichzeitig Hotspot, Server und eigenes Spielgerät sein?
- Welche Add-ons auf Stufe 2 trotzdem gehen könnten (z. B. Piper im Browser).
- Bezug zur Vermarktung (docs/16): Stufe 1/2 als Free/Band, Box als eigenes Produkt?
