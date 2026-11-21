# 37 – Testplan für das Baseline (PR #966)

Stand 2026-11-21. Das Baseline ist `main` plus der ganze Host-Stapel (#957–#965) und der Add-on-Vertrag (docs/36). Alles hier steht unter `npm run verify` (grün), aber **auf Geräten ist fast nichts davon gelaufen** – das ist der Zweck dieses Plans. Was „gesehen“ heißt: auf einem echten Gerät, von einem Menschen. Was nur Tests belegen, steht nicht in der Spalte „schon gesehen“.

## 0. Vorbereitung

| Schritt | Wie |
|---|---|
| Stand holen | `git fetch && git checkout baseline/add-on-contract && npm ci && npm run verify` |
| **Nicht** auf den produktiven Host (8443) | Test-Host auf eigenem Port mit eigenem Zustand: `PORT=8450 STAGEBOARD_DB_PORT=5950 STAGEBOARD_HOST_ID=test STAGEBOARD_STATE_DIR=/tmp/sb-test STAGEBOARD_WORKSPACE=<Band-ID> node packages/core-backend/dist/index.js` (nach `npm run build -w shared-types -w sync-host -w core-backend`) |
| Produktiver Host (später) | `tools/server/deploy-ref.sh switch origin/baseline/add-on-contract` – baut jetzt auch `sync-host`. **Vorher** `deploy-ref.sh status` ansehen, und danach `revert` bereithalten. Erst wenn der Test-Host sauber lief. |
| Test-App auf einem Tablet | `VITE_DEV_APP=1 npm run build -w stage-pwa`, `npx cap sync android`, dann in `packages/stage-pwa/android`: `./gradlew assembleDebug -PstageboardAppIdSuffix=.dev.test -PstageboardVersionCode=<höher als installiert>` und `adb install -r`. Das ist eine **zweite App** neben der echten. Jeweils nur eine StageBoard-App offen haben. |
| Werkzeuge | `yt-dlp` (`YT_DLP_PATH`), für Stems `STEMS_PYTHON` mit Demucs, für Sprache `PIPER_BIN`, für Ultimate Guitar Chrome/Chromium |

## 1. Add-ons – was sich für Menschen geändert hat

| # | Test | Erwartung | Schon gesehen |
|---|---|---|---|
| 1.1 | System → **Add-ons** → YouTube installieren, Song → Audio → **Track hinzufügen** | Knopf „YouTube“ gleich hoch wie „Datei wählen“ | ja (Fire, 2016) |
| 1.2 | „YouTube“ antippen | Der erste Dialog schließt sich, der YouTube-Dialog öffnet **allein** (kein Popup auf Popup); Suchfeld ist mit „Titel Band“ vorbelegt; „Fertig“ bringt zurück | ja |
| 1.3 | Suchen | Treffer mit Vorschaubild, Kanal, Länge; „Ansehen“ öffnet das Video außerhalb von StageBoard und wählt nicht aus | ja (Link-Knopf **nicht** mehr gesehen, seit Build 2016) |
| 1.4 | Treffer antippen | Fortschrittsbalken läuft, danach „Fertig – die Spur ist im Song“, die Spur erscheint, spielt ab; die Job-Zeile verschwindet nach ca. 5 s von selbst | teilweise |
| 1.5 | Einen YouTube-Link statt eines Suchbegriffs einfügen | Lädt ohne Suche | nein |
| 1.6 | Einen Nicht-YouTube-Link einfügen | Meldung des Add-ons „Nur youtube.com/youtu.be-Links …“, kein Job | nein |
| 1.7 | Host abschalten, Dialog öffnen, suchen | Verständliche Meldung, kein Hängen | nein |
| 1.8 | Einen Job fehlschlagen lassen (z. B. `YT_DLP_PATH` falsch) | Die Zeile bleibt mit der Meldung stehen, bis man „Ausblenden“ tippt | nein |
| 1.9 | **Tablet ohne Laptop**, Android-Helfer-App installiert | Suche und Download laufen über das Gerät selbst | **nein – die Helfer-App ist auf keinem Gerät installiert** |
| 1.10 | Neuer-Song-Assistent / Song-Editor: MusicBrainz-Suche | Treffer, Detail | nur gegen die echte API von Hand getestet, nicht in der App |
| 1.11 | Ultimate Guitar: Suche, **einzelnen Tab importieren**, ChordPro prüfen | Beste Version zuerst, Pro/Video fehlen; Tab-Import geht (`tabs.ultimate-guitar.com`); Meldungen bei Cloudflare/Timeout auf Deutsch | **nein** (der Tab-Import war bis zur Review kaputt) |
| 1.12 | OSC: Cue an ein echtes Lichtprogramm (QLC+, Resolume …) | Paket kommt an, Wert/Adresse stimmen; ungültige Adresse → deutsche Meldung, nichts gesendet | **nein** (nur echte UDP-Pakete gegen einen Test-Empfänger) |
| 1.13 | System → **Bühne** → Zeile eines OSC-Geräts | Unter dem Namen die Karte „Zuletzt gesendet: …“, folgt dem nächsten Cue ohne Neuladen; bei anderen Geräten **keine** Karte | **nein** |
| 1.14 | Sprachansagen (Piper) | Klang, Cache, Stimme wählen/herunterladen | eingebaute Umsetzung wie vorher; Add-on-Weg nur mit `STAGEBOARD_ADDON_SANDBOX=1` |
| 1.15 | Stem-Trennung (Demucs) | Stems erscheinen unter der Quelle, Fortschritt | wie 1.14 |

**Mit und ohne** `STAGEBOARD_ADDON_SANDBOX=1` auf dem Test-Host 1.14 und 1.15 wiederholen und vergleichen (Dauer, Ergebnis, Speicher des Hosts). Das ist die Entscheidungsgrundlage, ob der Add-on-Weg zum Standard wird.

## 2. Host und Band (der Teil von #957–#963)

| # | Test | Erwartung | Schon gesehen |
|---|---|---|---|
| 2.1 | Band gründen auf einem frischen Test-Host, mit `STAGEBOARD_WORKSPACE` aktiv | Band erscheint, Heartbeat „online“ | ja (Fire) |
| 2.2 | Zweites Gerät beitreten (QR/Code), Mitglieder anlegen, PIN | Wie vorher | früher auf Phone/Laptop ja, mit diesem Stand nein |
| 2.3 | **Ausfall des Hosts**: Tablet-Host übernimmt (`tools/host-test/failover.mjs`) | 17/17 | ja (Fire + Redmi, vor den Add-on-Änderungen) |
| 2.4 | Tablet als einziger Host, Band ohne Laptop (`tools/host-test/no-laptop.mjs`) | 42/42 | ja (Redmi, vor den Add-on-Änderungen) |
| 2.5 | Tablet-Host: `device-state` | **fehlt** (Android-Arbeit in `LocalHostPlugin.java`) – ein Tablet als einziger Host zeigt keinen Gerätezustand | bekannt offen |
| 2.6 | Auf dem Tablet-Host einen Add-on-Aufruf (`POST /addons/…`) | 501 `capability_missing` mit Begründung, nie 404 | nur in Tests |

## 3. Wo ich besonders hinsehen würde

- **Touch und Tastatur** in den Add-on-Dialogen (Tastatur verdeckt Feld/Liste? Treffer gut tippbar?).
- **Fortschritt und Ende** eines Downloads auf einem langsamen Tablet (Fire: 426 MFLOP/s). Die Spur wird als Ogg Opus angelegt; was kein Opus ist, wird auf dem Gerät mit WASM umkodiert – das **kostet dort Zeit** und ist auf dem Tablet nicht gemessen.
- **Zwei Geräte gleichzeitig** im selben Dialog (Job-Zeilen, Doppelklick, was sieht das zweite Gerät?).
- **Speicher des Hosts** über Stunden mit aktiver Sandbox (`ps`): ein Prozess pro benutztem Add-on, er läuft bis zum Ende des Hosts.
- **Alte Daten**: Spuren mit `source: 'youtube-extract'` spielen weiter; ein früher angelegter, noch wartender `youtube-extract`-Job läuft **nicht mehr** (wird ignoriert).

## 4. Bekannte Unterschiede zu vorher (sollten niemanden überraschen)

- Die Wahl „Erweitert → nur Host / nur dieses Gerät“ für YouTube ist weg: ein Host, der kann, wird benutzt, sonst das Gerät selbst.
- Ein OSC-Befehl, den das Add-on nie deklariert hat, wird mit englischem Text („declared no method“) an der Grenze abgelehnt.
- In der App steht überall „Host“ statt „Server“ (52 Texte, de/en).

## 5. Was dieser Plan **nicht** belegt

- Dass ein Add-on im Browser „nichts im Netz tun kann“: Es bekommt keine Netz-API, aber ohne Content-Security-Policy ist ein dynamischer `import()` nicht abgedeckt (docs/36 §5). Dasselbe gilt für Node (`--allow-net` fehlt).
- Lange Läufe (Stunden) mit dem Add-on-Weg für Stems/Sprache.
- Die Messungen aus `docs/25` (Soak) für diesen Stand: der Fire-Stresslauf ist am Mess-Werkzeug gescheitert (4 GB), die Ursache ist nicht untersucht.
