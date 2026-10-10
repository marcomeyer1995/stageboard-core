# Backing-Track synchron wiedergeben: Untersuchung vom 2026-10-09/10 (#468)

Diese Datei dokumentiert die Untersuchung, die mit „der Backing-Track stottert im Gig-Modus über Bluetooth“ begann und bei einer neuen Wiedergabe-Architektur für den Track endete. Ziel: bevor die Track-Wiedergabe, der Klick, der Start eines Songs oder die Übertragung von Play/Pause wieder angefasst werden, hier nachlesen. **Ein Teil ist bewusst offen - siehe Abschnitt 6.**

**Kurzfassung:** Das `<audio>`-Element lässt sich nur von außen schubsen: nach jedem Start oder Sprung steht seine Position eine wechselnde Zeit still (bis 620 ms), und jede Geschwindigkeitsänderung setzt intern etwas zurück. Jede Nachführung darauf erzeugt Rückkopplungen (Sprung-Schleife, Geschwindigkeits-Zittern). Lösung im Prototyp: der Track läuft über Web Audio auf **derselben Audio-Uhr wie der Klick**, wird **beim Abspielen in Stücken dekodiert** (mediabunny + WebCodecs, jedes gängige Format) und probengenau geplant. Dazu: Play startet den Song **400 ms in der Zukunft** (Ahead-of-Time, docs/00 §4), und ein **unhörbares Signal hält den Ausgabeweg wach** (Bluetooth schläft sonst nach 2-3 s ein und verschluckt den Song-Anfang). Offen: Play wandert als Datenbank-Schreibvorgang über zwei Replikationen - vom Fire bis zu 1 s - und braucht einen direkten Weg über den Stage-Server.

## 1. Chronologie

| Schritt | Beobachtung | Messung | Ergebnis |
|---|---|---|---|
| 1 | S26+ mit Fender Mustang Micro Plus (Bluetooth): Solo sauber, Gig stottert | AudioFlinger: **0 Underruns** in beiden Modi | Kein Leistungsproblem - die App springt im Track |
| 2 | Gig-Nachführung `syncLocalTrackPosition`: Seek ab 200 ms Abweichung, jeden Frame | CDP-Hook auf den `currentTime`-Setter: **195 Seeks in 45 s**, alle 230 ms, je 200-210 ms | Seek-Schleife: nach jedem Seek steht die Position (Bluetooth-Anlauf), Abweichung wieder > 200 ms |
| 3 | Solo-Messung desselben Geräts | Anlauf nach jedem Start 0 / 340 / 620 ms, danach **exakt 1,0 × Echtzeit** | Einmalige Anlaufzeit, kein Dauerversatz → **#469**: nach Seek warten, kleine Abweichung über Geschwindigkeit (gemergt, App 1.379) |
| 4 | Xiaomi-Tablet mit #469: kleines Stottern alle ~2 s | **587 Geschwindigkeitswechsel in 63 s**; bei Rate 1 lief die Position nur 0,963 × Echtzeit | Geschwindigkeit fest auf 1 gezwungen (per CDP): **1,000 × Echtzeit, kein Stottern** - die Wechsel selbst kosten Zeit und knacken |
| 5 | Grundsatzentscheidung | Klick (Web Audio) ±3 ms konstant, Track (`<audio>`) ±12-17 ms je Start (docs/13 §7) | Track auf die Klick-Uhr: Web Audio |
| 6 | Prototyp B: ganzen Song vorher dekodieren | Xiaomi: 1,3 s / 66 MB für 171 s Opus; bei schnellem Wechsel **1,5-13 s**, nicht abbrechbar | Klang gut, aber zu langsam beim Weiterschalten |
| 7 | Bug: zweimal schnell weiter + Play spielte den **falschen Song** | - | Dekodierter Ton hing nicht an seinem Song → Ton nur noch unter eigenem Schlüssel, Regressionstest |
| 8 | Lücken nach schnellem Wechsel | Song-Zeit beim Rendern berechnet, Audio-Uhr erst im Effekt gelesen - 130-160 ms Hauptthread-Stau dazwischen | Falsche Neustarts → Song-Zeit und Uhr im selben Moment lesen, Neustart erst nach 2 Messungen, Neustart mit Überblendung |
| 9 | Prototyp C: Streaming (mediabunny + WebCodecs) | Vorbereitung **0,17-0,94 s** je Song, 0 verspätete Stücke | Schnelles Weiterschalten ohne Warten |
| 10 | Anfang von „Highway to Hell“ fehlt | Start-Protokoll: Start bei **0,165 s** statt 0 | Play startete den Song „jetzt“ - **Ahead-of-Time: 400 ms Vorlauf** (`PLAY_LEAD_MS`, queue.ts) → Start bei 0 |
| 11 | Anfang fehlt trotzdem, auch in der Timeline-Ansicht | Logcat: Bluetooth-Strom nach 2-3 s Stille im Standby, App öffnet beim Start neuen Audio-Strom | Unhörbares Signal (40 Hz, −80 dB) per CDP: **Anfang vollständig** → eingebaut (`holdAudioOutputAwake`) |
| 12 | Play vom Fire: Anfang fehlt am Xiaomi | Start-Protokoll: Play kam **0,9-1 s** zu spät an; Server bekam den Schreibvorgang 0,6 s nach dem Zeitstempel | Play über die Datenbank-Replikation zu langsam → **#472**: Master-Änderungen direkt über den Stage-Server an alle Geräte (SSE) |
| 13 | Mit #472: Ankunft gemessen | Server-Log „Show state reached device“: **11-130 ms** je Gerät und Play | Schneller Weg trägt |
| 14 | Fire zeigt „BEREIT“, Xiaomi spielt; einmal spielte der Xiaomi AC/DC, der Fire zeigte einen anderen Song | Server-DB stand auf dem zweiten „Weiter“, Play fehlte; Overlay hielt nur die letzte Push-Änderung | `putShowState` verlor bei „Weiter, Weiter, Play“ den späteren Schreibvorgang (409, still verworfen); nur der letzte Push lag über der DB → **#473**: Schreiben in Warteschlange mit Wiederholung, Pushes sammeln sich bis die DB aufholt |
| 15 | Anfang nach schnellem Wechsel weiter angeschnitten | Start-Protokoll: 26 von 30 Starts bei Song-Zeit +10 bis +151 ms, Track ab 160-300 ms; Songs waren rechtzeitig vorbereitet | Vorlauf (und Einzählung!) galt nur, wenn `activeEntryStartedAt` leer war - „Weiter“ setzt es sofort → jetzt für jeden neuen Durchgang (Transport gestoppt), nur Fortsetzen nach Pause ohne |

Nebenbefunde am selben Abend: das eero-Mesh ließ S26+ und Laptop auf demselben Knoten nicht miteinander sprechen (zufällige MAC, später Gerät überall entfernt und neu verbunden); am Laptop (Stage-Server) war WLAN-Energiesparen an (`wifi.powersave = 3`, 3-118 ms zur Fritz!Box) - jetzt aus, 1-9 ms. Der Stage-Server hängt weiter im WLAN; Kabel empfohlen.

## 2. Warum das `<audio>`-Element nicht trägt

- Start und Sprung haben eine **unbekannte Anlaufzeit** (0-620 ms, Gerät und Ausgabeweg abhängig).
- `currentTime` sagt nicht zuverlässig, was gerade aus dem Lautsprecher kommt.
- `playbackRate`-Wechsel **setzen die Pipeline teilweise zurück** - jeder Wechsel kostet Zeit und ist hörbar.
- Damit erzeugt jede Nachführung Rückkopplung: Seek → Stillstand → Seek (S26+), Rate → Zeitverlust → Rate (Xiaomi).

## 3. Die neue Wiedergabe (Prototyp, Schalter je Gerät)

Einstellungen → Dieses Gerät → „Wiedergabe (Test)“ → „Backing-Track über Web Audio“ (`localStorage` `sb:audio:webaudio-track`). Nur Gig-Modus; Solo und Timeline nutzen weiter `<audio>`.

- **Eine Audio-Uhr:** `sharedAudioContext.ts` - Klick und Track auf demselben `AudioContext`, gleicher Ausgabeweg. Uhr-Glättung gemeinsam in `audioClock.ts` (vorher in clickEngine.ts).
- **Streaming:** `trackStream.ts` öffnet die Datei mit mediabunny (`ALL_FORMATS`: MP4/M4A/MOV, WebM/MKV, Ogg, MP3, WAV, ADTS-AAC, FLAC, …), dekodiert über WebCodecs ab beliebiger Position. Was das Gerät nicht streamen kann, dekodiert `decodeAudioData` am Stück (Fallback). mediabunny wird erst bei Bedarf geladen (eigene Datei, 87 kB gzip), Lizenz MPL-2.0 (siehe docs/16 zur Code-Lizenz).
- **Planung:** `webAudioTrackEngine.ts` - die ersten 1,5 s des aktuellen und des nächsten Songs sind vorab dekodiert; beim Abspielen wird ~4 s voraus dekodiert, in ~0,5-s-Stücken lückenlos auf die Audio-Uhr gelegt. Ein übersprungener Song hört sofort auf zu dekodieren; immer nur eine Vorbereitung gleichzeitig, der gewählte Song zuerst.
- **Nachführung:** Drift (Quarz gegen Server-Uhr) über die Rate der nächsten Stücke, höchstens ±0,1 % (1,7 Cent, unhörbar, kein Pipeline-Reset). Abweichung > 80 ms in zwei Messungen hintereinander = Sprung → Neustart an der richtigen Stelle, überblendet.
- **Start:** Play legt Song-Zeit 0 `PLAY_LEAD_MS` = 400 ms in die Zukunft (bzw. die Einzählung, wenn länger); jedes Gerät plant den Track genau auf 0.
- **Wachhalten:** `holdAudioOutputAwake` - solange das Gerät Gig-Audio-Ausgabe ist oder den Klick spielt, läuft ein 40-Hz-Signal bei −80 dBFS.

## 4. Messmethodik (wiederverwendbar)

1. **AudioFlinger per adb** (`dumpsys media.audio_flinger`): Spalte `Underruns` des App-Tracks (Frames) zeigt, ob das Gerät mit Ton nicht nachkommt; Output-Thread `Standby` zeigt, ob Bluetooth schläft. 0 Underruns + Stottern = die App springt selbst.
2. **Release-App ist nicht inspizierbar.** Debug-Build installieren (`./gradlew assembleDebug`, anderer Schlüssel → Release-App vorher deinstallieren, danach neu koppeln). Xiaomi blockiert `adb install` ohne „Über USB installieren“: APK nach `Download/` kopieren und im Dateimanager öffnen; Updates per `adb install -r` gingen dann direkt. WebView-Socket `webview_devtools_remote_<pid>` ändert sich bei jedem App-Neustart.
3. **CDP-Hooks** (Skripte lagen im Scratchpad, Muster hier): `Page.addScriptToEvaluateOnNewDocument` mit einem Wrapper um den `currentTime`- und `playbackRate`-Setter von `HTMLMediaElement.prototype` (jeder Seek/Ratenwechsel mit Zeitstempel), Media-Events (`seeking`, `waiting`, …), Position alle 200 ms; `Media.enable` liefert Pipeline-Ereignisse (`BUFFERING_HAVE_NOTHING` = Puffer leer). Ein Schalter im Hook (`window.__sbLockRate`) erlaubte Experimente ohne neuen Build.
4. **Motor-Statistik:** `window.__sbWebAudioTrack` - Vorbereitungszeiten, Starts mit Startposition (`startLog`), verspätete Stücke (`late`), Neustarts mit Abweichung, Rohwerte der ersten 4 s nach jedem Start (`trace`: Wanduhr, Audio-Uhr roh/geglättet, Song-Zeit).
5. **Ausbreitung von Play:** Show-State in CouchDB (`_changes`, `playbackStartedAt`) gegen die Empfangszeit des `_bulk_docs` im Server-Log (`journalctl --user -u stageboard`).
6. Hypothesen per Eingriff prüfen, nicht raten: Rate auf 1 sperren (Xiaomi), Wachhalte-Signal per CDP starten (Bluetooth) - jeweils ein Lauf, klares Ergebnis.

## 5. Zahlen zum Nachschlagen

| Gerät / Weg | Wert |
|---|---|
| S26+ → Mustang (Bluetooth, Hardware-Encoding) | Android-Ausgabelatenz ~311 ms; Anlauf nach Start/Seek 0-620 ms |
| Xiaomi → Mustang | Ausgabelatenz ~151 ms; Anlauf ~490 ms |
| Xiaomi: ganzer Song dekodieren | 1,3-1,6 s (Opus 48 kHz) bis 3,6-5,6 s (andere), 66-112 MB |
| Xiaomi: Streaming-Vorbereitung | 0,17-0,94 s |
| Play-Ausbreitung Xiaomi als Master | Song-Zeit beim Empfang −377 bis −388 ms (bei 400 ms Vorlauf) |
| Play-Ausbreitung Fire als Master (alte App) | +10 ms bis +981 ms |
| Bibliothek | 13 MP3, 12 MP4/AAC, 4 WebM/Opus, 2 WAV; WebCodecs am Xiaomi: Opus, AAC, MP3, PCM ja |

## 6. Offen

1. ~~Schneller Weg für Transport-Befehle~~ - erledigt (#472, 11-130 ms). `PLAY_LEAD_MS` bleibt 400 ms; nach mehr Messungen (`journalctl --user -u stageboard | grep "Show state reached device"`) ggf. kürzen.
2. **Fortsetzen nach Pause** startet weiter „jetzt“ - der Track setzt ~0,2 s nach der Pausenstelle ein. Klein (meist wird in Ansagen pausiert). Lösung: Fortsetzen mit Vorlauf, die Song-Zeit steht dabei 0,4 s still (sonst würde das Stück davor doppelt gespielt).
2b. **Nahtlose Übergänge** (#232, `skipCountIn`) starten Song B erst, wenn A endet, und ohne Vorlauf - B kommt ~0,15-0,3 s zu spät. **Zurückgestellt (Marco, 2026-10-10, nicht in Benutzung):** genaues Timing allein macht den Übergang nicht gut. Heute wird B nur an das Dateiende von A gehängt; hat A Ausklang oder Stille am Ende, oder einen unvollständigen letzten Takt, holpert es trotzdem. Wer das angeht, beginnt mit der Frage nach dem **Takt**, nicht nach dem Timing:
    - Wo setzt B ein: auf der nächsten Eins von A, nach N Takten, an einem festen Punkt in A? Grundlage ist das Beat-Raster beider Songs (docs/14).
    - Unterschiedliche Tempi: bewusster Tempowechsel an einer Taktgrenze oder allmählicher Übergang (der Track kann das ohne Time-Stretching nicht mitgehen).
    - Der Klick muss den Übergang mitgehen, ohne Bruch.
    - DJ-Übergang oder „zusammengehörende Songs als ein vorbereiteter Block“ - Gestaltungsfrage vorab klären.
    Erst danach: B im Voraus auf den so bestimmten Zeitpunkt planen (gleiche Technik wie der Ahead-of-Time-Start, Bezug ist dann das Raster statt des Dateiendes).
2a. **Setlist-Köpfe vorab dekodieren** (erste 1,5 s jedes Setlist-Songs, ~0,6 MB je Song) ist gebaut, aber geparkt (`git stash`, „setlist head cache“) - die Songs waren rechtzeitig bereit, Ursache war der fehlende Vorlauf. Wieder aufnehmen, falls Vorbereitungszeiten auf langsamen Geräten (Fire) zu lang sind.
3. **Prüfspur + Mitschnitt:** Testtrack mit Marke bei 0,000 s und Pieps alle 100 ms mit eigener Tonhöhe (WAV, MP3, AAC, Opus); Mitschnitt dessen, was der Motor ausgibt, um „beginnt genau bei 0 und ist vollständig“ je Format zu messen. Danach der echte Ausgang im Synchronitätstest (docs/17/18).
4. **Fire HD 10:** neue App, Codecs prüfen (WebView 138), Speicher, Last (#457/#460).
5. **Klangqualität beim Umrechnen** 44,1 → 48 kHz (die Stücke werden von der Web-Audio-Quelle umgerechnet) - Hörvergleich.
6. **Hintergrund / Bildschirm aus**, **Android-Audiofokus** (Anruf), Ausgabewechsel mitten im Song (Bluetooth an/aus).
7. **Solo und Timeline** auf den neuen Motor umstellen; danach `<audio>`-Pfad und #469-Nachführung zurückbauen.
8. Einzelne Neustarts kurz nach Song-Beginn (0,7-2,3 s, früher gesehen) - seit #473 nicht mehr aufgetreten; beobachten.
9. Die Einzählung nach „Weiter“ fehlte bisher ganz (gleiche Ursache wie Nr. 15) - mit diesem Fix zählt jeder neue Durchgang ein, wenn die Variante eine Einzählung hat.
