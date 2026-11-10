# Betriebsstufen: StageBoard ohne festen Stage-Server

Grundidee, Stand 2026-10-28, mit Marco besprochen am 2026-10-27/28. Seit 2026-11-07 entschieden und begonnen: §6a. Ergänzt [docs/02](02_Ausbaustufen_Konzept.md) (Hardware-Matrix) und berührt Kern-Prinzip 1 in CLAUDE.md („Der Stage-Server ist das Herzstück“).

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

## 6a. Entscheidungen und Stand (Marco, 2026-11-07)

| Frage | Entscheidung |
|---|---|
| Reihenfolge | zuerst alle offenen PRs mergen und ausrollen (erledigt: main e78f86b, App 1.580), dann **Server ohne CouchDB**, dann **Spike Android als Host auf dem Redmi** |
| Wie ohne CouchDB | **eigenes kleines Modul** `packages/sync-host` in reinem TypeScript über PouchDB – nicht express-pouchdb (seit 2019 ungepflegt, PouchDB 7) und nicht Node auf Android (nodejs-mobile steht bei Node 18, der Fastify-5-Server braucht ≥ 20). Dasselbe Modul läuft auf dem Laptop (Fastify) und später in der Android-App (nativer Webserver → Modul in der App über die PouchDB, die sie schon hat) |
| Konten auf einem Android-Host (2026-11-07) | **C: Konten in den Banddaten** – jedes Gerät hat sie, jedes kann Host werden, auch bei Ausfall. Bedingung: dort liegen nur Schlüssel **langer Geräte-Passwörter** (wie die zufälligen 24-Byte-Logins der Tablets), **nie PIN-Schlüssel** – 4-stellige PINs wären offline in Sekunden zu erraten. Admin-Konten mit PIN brauchen dafür zusätzlich einen Geräte-Schlüssel |
| WLAN im Gig (2026-11-07) | **Sperre gegen Stromsparen im Gig-Modus auf allen Tablets** (#716): gemessen kam ein Play nach Pausen bis 125 ms später an; mit Sperre Handy Median 85-116 → 46 ms, Redmi p90 155 → 67 ms, Fire (Android 9) wenig |
| Server-Plugins auf der Karte | Download-Werkzeug, Stems, Piper usw. erscheinen am Host auf der Bühnen-Karte und sind dort installierbar, **wo der Host sie ausführen kann** (Linux/Windows ja, Android nein, grau „läuft auf diesem Host nicht“). Der Host meldet das (`GET /server/capabilities`) |

**Gebaut (Branch `feat/sync-host`):**
- `sync-host`: das Replikationsprotokoll (Info, Änderungs-Feed auch long-poll, `_revs_diff`, `_bulk_docs`, `_bulk_get`, `_all_docs`, Checkpoints, Dokumente, Anhänge) und darüber eine **kleine CouchDB** – Server-Admin, Konten nur als PBKDF2-Schlüssel (WebCrypto), `_session`, `_security` (CouchDB-3-Regeln), die `validate_doc_update`-Funktionen der Band bei jedem Schreiben (auch Replikation), Bandliste, Datenbanken anlegen/löschen. Getestet mit echter PouchDB-Replikation über HTTP und mit dem **unveränderten** `couch.ts`.
- Stage-Server: `STAGEBOARD_DB=builtin` startet sie im Prozess, Daten als LevelDB-Dateien (`STAGEBOARD_DB_DIR`, sonst `<STAGEBOARD_STATE_DIR>/database`), lauscht wo CouchDB lauschen würde (127.0.0.1:5984, `STAGEBOARD_DB_PORT`) – `couch.ts`, der `/db`-Proxy und die Kommandozeilen-Werkzeuge bleiben unverändert. Ohne Schalter weiter CouchDB.
- **Konten nach C** (2026-11-08): der Stage-Server legt die Schlüssel aller Geräte-Logins einer Band (CouchDB-PBKDF2, nie die PIN-Anker) ins Band-Dokument `host-accounts`; nur er darf es schreiben (Roster-Validator: `_admin`). Er folgt `_users`, also kommt jede Kopplung, jeder Rollenwechsel, jedes Entfernen und jedes Kommandozeilen-Werkzeug dort an. Probelauf auf der Kopie: SOAT 5, Abadschendaler 49 Geräte-Logins, kein PIN-Konto. Neu als Admin anmelden bleibt beim Stage-Server (Marco: einverstanden).
- `GET /server/capabilities`: Plattform, Datenbank, je Server-Plugin „läuft hier“ oder was fehlt (demucs, piper, chrome, yt-dlp).

**Gerätetest bestanden (2026-11-07, Marco zu Hause):** Testserver mit `STAGEBOARD_DB=builtin` über HTTPS auf einer aufgefrischten Kopie der echten Datenbank, die Dev-App auf dem Redmi darauf umgestellt: Play, Bibliothek (Song bearbeitet), Bühnen-Karte, Diagnose, Stage-Server-Reiter, Add-ons, Synchronisation – alles wie gewohnt; die Test-Änderungen blieben nur in der Kopie.

**Noch offen:** echter Lauf auf dem Laptop mit einer frischen Band und mehreren Tablets; Umzug einer bestehenden Band von CouchDB (Replikation, die Daten liegen auf jedem Gerät); die Plugins auf der Karte in der App; dann der Android-Spike.

## 6b. YouTube-Download auf jedem Host (Marco, 2026-11-10)

| Frage | Entscheidung |
|---|---|
| Wo | **auf jedem Host** – auch ein Android-Gerät als Host, und ohne Host (Solo) auf dem Gerät selbst. Abweichend von „Server-Plugins auf der Karte: Android nein“ (§6a) für dieses Plugin |
| Wie ausgeliefert | **nicht in der App**: ein eigenes Plugin, das jeder selbst installiert und für das er selbst verantwortlich ist (rechtliche Frage aus docs/16 §A.2 „riskante Funktionen abtrennen“ und Lizenz des YouTube-Codes). Nur für private Entwicklungszwecke |
| Format | alles als **Ogg Opus** (docs/30 §8h): YouTubes Opus-Stream wird verlustfrei umgepackt, alles andere umgewandelt – „immer, auf jeden Fall“, nicht abhängig davon, was auf dem Host installiert ist |

**Umsetzung (Vorschlag):** auf Android eine **eigene kleine Plugin-App** (eigenes Paket neben `de.stageboard.app`, gebundener Dienst: suchen, Opus-Stream laden mit Fortschritt); die StageBoard-App erkennt sie, ohne sie fehlt sie nur auf der Karte. Darin **NewPipeExtractor** (Java, GPL-3) – nur in der Plugin-App, nie im StageBoard-APK. Umpacken/Umwandeln in der App (`webmOpusToOgg`, Opus-Encoder als WASM), dadurch auf jedem Host gleich. Laptop/PC-Host weiter mit `yt-dlp`.

**Machbarkeit geprüft (2026-11-10, Laptop, NewPipeExtractor v0.26.5 im JDK 21):** zu einem Video in 2,6 s alle Audio-Streams (M4A 139/140, Opus 249/250/**251 mit 160 kbit/s**), Opus 251 geladen (10,2 MB in 2,6 s, in 10-MB-Bereichen) – **byte-identisch** zur Datei von `yt-dlp -f 251`; umgepackt nach Ogg gültig, Länge bei OpusClip und ffmpeg gleich. Suche (#618): 10 Treffer in 2,5 s mit ID, Titel, Kanal, Dauer. Bibliotheken zusammen 3,6 MB (Rhino 1,3, Protobuf-Lite 1,0, Extractor 0,8, Jsoup 0,5). Offen: auf dem Gerät (Android-HTTP statt JDK-Client), wie lange eine Version hält, bis YouTube sie bricht (Updates des Plugins).

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
