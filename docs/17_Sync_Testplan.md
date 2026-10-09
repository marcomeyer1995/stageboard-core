# Testplan Synchronität (Referenz-Song, #464)

Stand: 2026-10-09, ausführliche Fassung zur Freigabe durch Marco. Vorbereitung, Einkauf, Aufbauvarianten und Grenzen: docs/18. Werkzeuge: Referenz-Song (`lib/referenceSong.ts`, `scripts/import-reference-song.mts`), Auswertung (`lib/syncAnalysis.ts`, `scripts/analyze-sync-recording.mts`). Methode und frühere Messwerte: docs/13 §6–§7, docs/09 (Uhrabgleich), docs/11 (Netzlast).

## 0. Zweck

Das ganze Konzept von StageBoard steht darauf, dass alle Geräte einer Band **im selben Moment dasselbe hören und sehen** - Klick, Backing-Track, Prompter, Einzählen, Blitze - und dass Cues an Effektgeräte und Licht **auf den Schlag** kommen. Bisher gibt es dazu nur Einzelbeobachtungen (Klick holpert, Track sägt auf dem Xiaomi, Klick auf dem S26 gefühlt verschoben). Dieser Test misst es vollständig: mit bekannter Wahrheit (jeder Schlag des Referenz-Songs ist auf die Millisekunde bekannt), auf dem echten Bühnenweg (Kopfhörerausgang ins Pult) und reproduzierbar. Er liefert die Entscheidungsgrundlage für Ausgleich je Gerät (#302), Geräteprofil (#303), die Nachführung des Tracks, den Server-Klick (#25), externe Latenzen (#317) und die Wahl der Server-Hardware.

## 1. Was „synchron“ heißt

- **Songzeit:** die gemeinsame Zeit des Songs (ms ab Takt-1-Bezug, Uhr des Stage-Servers über den Uhrabgleich).
- **Ausgabezeitpunkt:** wann ein Ereignis **am Ausgang des Geräts** hörbar bzw. sichtbar wird - nicht wann die App es plant. Nur das zählt für die Musiker.
- Drei Ebenen:
  1. **Im Gerät:** Klick gegen Track desselben Geräts (was ein Musiker im Ohr hat).
  2. **Zwischen Geräten:** Klick/Track von Gerät A gegen Gerät B (was die Band als „klappert“ hört).
  3. **Nach außen:** MIDI-Cues, Licht, Blitz/Bildschirm gegen die Songzeit.
- **Versatz:** Klick minus Track in ms; negativ = Klick kommt vor dem Track.
- **Streuung:** Standardabweichung innerhalb eines Abschnitts; **Drift:** Änderung des Versatzes pro Minute; **Sprung:** Änderung des Track-Versatzes > 40 ms von einem Schlag zum nächsten (Positionskorrektur).

## 2. Hypothesen (vorher festgehalten)

Werte aus docs/13 §7 (Lautsprecher, 2026-09-28) und den Messungen vom 2026-10-08/09. Der Test bestätigt oder widerlegt sie.

| Nr. | Hypothese | Erwartung |
|---|---|---|
| H1 | Im **Timeline-Editor** folgt der Klick der Track-Position: Versatz ≈ Unterschied der Ausgabewege des Geräts, stabil. | Xiaomi: Klick ~100–160 ms vor dem Track; Fire: Klick ~50–100 ms nach dem Track; Laptop: ~0–10 ms |
| H2 | In **Solo und Gig** folgt der Track der Songzeit, wird aber erst ab 200 ms Abweichung nachgeführt - der Versatz liegt dauerhaft im Bereich bis ±200 ms, je Gerät verschieden. | |Versatz| 50–200 ms, je Gerät konstant |
| H3 | Auf dem **Xiaomi mit main** sägt der Track (fällt ~35 ms/s zurück, Sprung bei −200 ms); mit **#460** nicht. | main: ≥ 5 Sprünge/40 s; #460: 0 |
| H4 | **Zwischen Geräten** liegen die Klicks so weit auseinander wie ihre Ausgabewege (bis ~370 ms Fire gegen Xiaomi), der Uhrabgleich selbst trägt < 10 ms bei. | Klick A gegen Klick B bis ~370 ms |
| H5 | **Tempowechsel, Ritardando, Taktartwechsel, Pause** erzeugen keinen zusätzlichen Fehler - außer im Takt mit Wechsel innerhalb des Takts. | Abschnitte wie „gleichmäßig“ ± 2 ms |
| H6 | **USB-C-Klinkenadapter** (S26, Xiaomi-Handy) fügen eine eigene, feste Verzögerung hinzu. | +10–40 ms |
| H7 | **Browser und Android-App** verhalten sich gleich (beide Chromium). | Unterschied < 5 ms |
| H8 | **Netzlast** verschiebt den Klick nicht (lokal geplant), kann aber die Track-Nachführung stören. | Klick unverändert, Track ggf. Sprünge |
| H9 | **Bildschirm aus** hält den Klick an oder verschiebt ihn (bewusst so entschieden, „Synchron vor Hintergrund“). | Klick stoppt/Lücke, danach Wiedereinstieg |
| H10 | **Server-Hardware** (Laptop vs. Mini-PC) beeinflusst nur den Uhrabgleich, nicht die Ausgabe. | Unterschied < 5 ms |

## 3. Einflussgrößen

| Größe | Werte | Im Test |
|---|---|---|
| Gerät | Xiaomi-Tablet, Xiaomi-Handy, Fire HD 10, Samsung S26, Laptop (Chrome), optional Windows-Tablet | variiert |
| Laufzeit | Browser (Chrome/Silk), Android-App (Version notieren) | variiert (S11) |
| Build | main, #460 | variiert (S11), sonst fest |
| Modus | Editor, Solo, Gig | variiert |
| Rolle | Klick-Ausgabe, Audio-Ausgabe, beides, nur Master | variiert |
| Ausgabeweg | Klinke, USB-C-Adapter, (Bluetooth) | je Gerät fest, BT nur S12 |
| Lautstärke Gerät | fest (z. B. 50 %) | konstant |
| WLAN | normal / Last / schwach | S7 |
| Uhrabgleich | eingeschwungen (≥ 2 min nach Laden) | konstant, mitgeloggt |
| Energie | am Strom, Energiesparen aus | konstant |
| Bildschirm | an | konstant, außer S8 |
| Server | Laptop, später Dell | S14 |

## 4. Messaufbau

### 4.1 Hardware

- **Stage-Server:** Laptop (heutiger Produktivserver); für S14 der Dell-Mini-PC.
- **Aufnahme:** Soundcraft **Ui24R per USB am Laptop** - wird als Soundkarte erkannt; alle Eingänge werden gleichzeitig mit einer Uhr aufgenommen.
- **Ui24R-Kanäle** (Line-Eingänge, Gain so, dass die lautesten Pieps bei ca. −12 dBFS liegen): Belegung, Ausgabewege (P1–P6), MIDI-Strecken (M1–M4) und Rollen (R1–R3) stehen in **docs/18 §4 und §7.2** - dort ist die maßgebliche Fassung.
- **Kanal-Einstellungen am Ui24R:** alle Effekte, EQ, Kompressor, Gate, Hochpass **aus**, Phantomspeisung aus, Aufnahme-Abgriff **vor** der Bearbeitung (direkt nach dem Vorverstärker). Kein Monitoring über Lautsprecher nötig.
- Jedes Gerät gibt **Klick und Track auf denselben Ausgang**, wie ein Musiker es im Ohr hat. Wo ein Szenario es verlangt, spielt ein Gerät nur den Klick oder nur den Track.

### 4.2 Material

Einkaufs- und Packliste: **docs/18 §3**.

### 4.3 Software und Daten

- Referenz-Song in der Band (Track „Beeps (Messung)“ aktiv, „Drums“ für S13).
- Builds: main und #460 (Vorschau). Je Gerät notieren: Browser/App, Version, Frontend-Hash.
- Logical Devices: „Click“ (Klick-Ausgabe) und „Mock Playback“ (Audio-Ausgabe) werden je Szenario auf das jeweilige Gerät gestellt (das Werkzeug merkt sich den Ausgangszustand und stellt ihn am Ende zurück).

### 4.4 Geräte vorbereiten (einmal)

- Android: Energiesparen/Akkuoptimierung für Chrome bzw. StageBoard aus, „Adaptiver Akku“ aus, Entwickleroptionen „Wach bleiben“ an, Bluetooth aus (außer S12), Nicht stören an, Systemtöne aus, Lautstärke fest.
- USB-Debugging an (Instrumentierung §6), Geräte per USB am Laptop.
- StageBoard: Referenz-Song lokal vorhanden (Einstellungen → Speicher & Sync), Audio-Sync „voll“.

### 4.5 Vor jedem Messblock

1. Alle Apps neu laden, **2 Minuten warten** (Uhrabgleich eingeschwungen, docs/09).
2. Pegel-Probe: 8 Takte, Pegel und Kanalzuordnung prüfen (Werkzeug zeigt je Kanal Spitze und erkannte Pieps).
3. Instrumentierung starten (§6).

## 5. Kalibrierung der Messkette (S0, vor allem anderen)

| Nr. | Prüfung | Vorgehen | Muss ergeben |
|---|---|---|---|
| K1 | Kanäle des Ui24R gleichzeitig | ein Gerät spielt den Referenz-Song, Y-Kabel auf Kanal 7 und 8 | Versatz Kanal 7 gegen 8 = 0 ± 0,1 ms |
| K2 | Taktgenauigkeit der Aufnahme | 10 min Referenz-Song (Schleife) vom Laptop | Abweichung der Schlagabstände < 50 ppm; sonst in der Auswertung korrigieren |
| K3 | Genauigkeit der Auswertung am echten Signal | Beeps-WAV vom Laptop direkt (ohne App) über Kanal 5 | alle Schläge gefunden, Streuung < 0,5 ms |
| K4 | Kein Übersteuern | Pegel-Probe | Spitzen ≤ −6 dBFS auf allen Kanälen |
| K5 | Auswertung erkennt Klick und Track auf einem Kanal getrennt | S2 auf dem Laptop, Vergleich mit der Monitor-Aufnahme (ohne Ui24R) | gleicher Versatz ± 1 ms |
| K6 | Ui24R gegen UMC204HD | dasselbe Signal per Y-Kabel in beide Interfaces, beide auswerten | gleicher Versatz ± 1 ms |
| K7 | Verzögerung MIDI-Strecke + Cue-Piepser | Laptop sendet MIDI über UMC204HD → UM-ONE → Piepser, piept gleichzeitig direkt | Wert wird von allen MIDI-Messungen abgezogen; Streuung ≤ 2 ms |

## 6. Instrumentierung (läuft bei jeder Aufnahme mit)

Damit Abweichungen erklärt werden können, nicht nur gemessen:

- **Je Gerät über USB-Debugging (CDP):** Uhrabgleich (Offset, Jitter), Songzeit der App gegen Position des Audio-Elements (wie gestern für den Sägezahn), CPU-Last des Hauptthreads, ausgelassene Frames, App-Fehler in der Konsole. Abtastung 2 ×/s, Zeitstempel in Serverzeit.
- **Je Gerät (adb):** WLAN-Signalstärke und -Frequenz, Akkustand und Temperatur, ob der Bildschirm an ist.
- **Server:** Log (Cues, Fehler), CPU, Zeitpunkte von Play/Pause/Stop aus dem Show-State.
- **Ereignisse:** jede Aktion des Ablaufs (Play, Pause, Neuladen, Master-Wechsel, WLAN aus/an) mit Zeitstempel - automatisch, wenn das Werkzeug sie auslöst, sonst per Tastendruck markiert.

## 7. Szenarien

Jedes Szenario: **3 Läufe** à 2:12 (ganzer Referenz-Song), wo nicht anders angegeben. Ausgewertet je Abschnitt: gleichmäßig, Ritardando, langsam, Sprung, Wechsel im Takt (nur berichtet), 3/4, Pause → Wiedereinstieg, Schluss.

### S0 Kalibrierung
Siehe §5. Ohne bestandenes S0 keine weiteren Messungen.

### S1 Timeline-Editor (Referenz je Gerät)
- **Ziel:** H1; Vergleichsmaß für S2/S3.
- **Ablauf:** Song im Editor, Klick an, abspielen, je Gerät.
- **Bewertung:** Versatz und Streuung je Gerät; keine Sprünge.

### S2 Solo/Üben
- **Ziel:** H2, H3; Marcos Beobachtung auf dem S26.
- **Ablauf:** Solo, Referenz-Song, Play, je Gerät (Klick und Track auf dem Gerät).
- **Bewertung:** gegen S1 desselben Geräts; Sprünge zählen.

### S3 Gig, ein Gerät spielt Klick und Track
- **Ziel:** H2 im Bandbetrieb.
- **Ablauf:** Gerät X ist Klick- und Audio-Ausgabe, ein anderes Gerät ist Master und drückt Play. Je Gerät einmal X.

### S4 Gig, Klick auf A, Track auf B
- **Ziel:** H4 - Drummer-Klick gegen Backing-Track vom Bühnen-Tablet.
- **Ablauf:** alle Paare der vier Mobilgeräte (12 gerichtete Paare; mindestens die 6 Paare in einer Richtung).
- **Bewertung:** Klick A gegen Track B; zusätzlich jeweils Klick-A-Zeit gegen die Songzeit.

### S5 Gig, alle Geräte klicken
- **Ziel:** H4 - Abstand der Geräte untereinander.
- **Ablauf:** alle Geräte geben den Klick aus, ein Gerät zusätzlich den Track.
- **Bewertung:** jedes Paar Klick A gegen Klick B; Streuung zwischen Geräten je Schlag.

### S6 Störungen mitten im Song (je 1 Lauf, 2 Wiederholungen)
| Fall | Aktion | Gemessen |
|---|---|---|
| a | Pause bei Takt 12, nach 5 s Weiter | Zeit bis Klick/Track wieder zusammen; Lücke |
| b | Stopp bei Takt 20, sofort Play | neuer Durchlauf sauber ab Einzählen |
| c | Audio-Ausgabe-Gerät bei Takt 30 neu laden | Wiedereinstieg des Tracks, Dauer |
| d | ein anderes Gerät bei Takt 30 neu laden | keine Wirkung auf die anderen |
| e | Master-Wechsel bei Takt 40 (Pro-Person) | Cues einmal, kein Sprung |
| f | WLAN des Audio-Ausgabe-Geräts bei Takt 45 für 10 s aus | Verhalten offline, Wiedereinstieg |

### S7 Netzlast
- a) Während des Songs lädt ein anderes Gerät einen großen Track (docs/11).
- b) Ein Gerät weit vom Router / hinter einer Wand (Signalstärke notieren).
- c) Zusätzlich ein Video-Stream auf einem fremden Gerät im selben WLAN.

### S8 Bildschirm aus / Hintergrund
- a) Klick-Ausgabe-Gerät: Bildschirm bei Takt 16 aus, bei Takt 32 an.
- b) App bei Takt 16 in den Hintergrund (Startbildschirm), bei Takt 32 zurück.

### S9 Cues und MIDI
Jede MIDI-Nachricht wird über den **Cue-Piepser** (Laptop, hört auf einen MIDI-Eingang, piept beim Empfang auf Ui24R-Kanal 7) zu einem Piep in derselben Aufnahme; seine Eigenverzögerung ist kalibriert (K7). Strecken (Einzelheiten docs/18 §4.6):
- **M1 Server → Gerät:** Server-Cue über das UMC204HD am Server → UM-ONE → Piepser. Cue gegen Songzeit und gegen Klick/Track.
- **M2 Tablet → Gerät:** Cue per WebMIDI über das UMC204HD am Tablet → UM-ONE → Piepser. Zusätzlich die Frage, ob WebMIDI am Tablet über ein Interface geht - im Browser und in der Android-App.
- **M3 Pedal → App:** Laptop sendet zu bekannter Zeit (und piept dabei) über UM-ONE → UMC204HD am Tablet; gemessen bis zur Reaktion der App (Play/Weiter → erster Klick).
- **M4 echtes Effektgerät** (wenn verfügbar): Patch-Wechsel hörbar über dessen Audio-Ausgang.
Referenz-Song mit vier Cues (Takt 9, 17, 29, 53). **Bewertung:** Cue gegen den Schlag; Pedal bis Reaktion.

### S10 Bild: Blitze, Einzählen, Prompter
- **Ablauf:** S26 im Zeitlupen-Video (240 oder 960 Bilder/s) auf zwei Bildschirme nebeneinander, das Handy-Mikrofon nimmt den Klick eines Geräts mit auf.
- Gemessen am Video Bild für Bild: Blitz „Ritardando in 2 Takten“ (Takt 15) und „Pause in 1 Takt“ (Takt 55), Zählblock beim Einzählen, Prompter-Zeilenwechsel bei Taktanfängen, gegen den hörbaren Klick.
- **Bewertung:** Bildschirm gegen Klick (Anzeige-Latenz) und Bildschirm A gegen Bildschirm B.

### S11 Builds und Laufzeiten (Querschnitt)
- S2 und S3 je Gerät mit **main** und **#460**, jeweils **Browser** und **Android-App**.
- Reihenfolge ABBA (main, #460, #460, main), damit ein zeitlicher Trend nicht als Unterschied erscheint.

### S12 Bluetooth-Kopfhörer (informativ)
- Ein Gerät mit BT-Kopfhörer; Kopfhörer-Ausgang per Mikrofon/Klinke-Adapter in den Ui24R, wenn möglich, sonst Mikrofon am Hörer. Erwartet: 150–300 ms - die Frage ist nur, ob man BT auf der Bühne ausschließen muss.

### S13 Echtes Material
- Referenz-Song mit Track „Drums“ statt der Pieps: Klick gegen Drum-Einsätze (Auswertung über Onsets wie docs/13 §6). Zeigt, ob die Pieps-Ergebnisse auf echte Musik übertragbar sind.

### S16 Audio-Interface am Tablet
Je Gerät: UMC204HD (und ggf. Ui24R als Soundkarte) über USB-C-Hub mit Laden am Tablet, gegen den Kopfhörerausgang desselben Geräts. Wird es erkannt, Versatz, Streuung, Akku, Knackser (docs/18 §4.2, P3/P4).

### S17 Licht (DMX)
Wege L0 (Wandler allein, Testprogramm), L1 (über QLC+), L2 (über Maestro), später L3 (StageBoard direkt, braucht ein DMX-Plugin) - docs/18 §4.7. Licht gemessen per Lichtsensor im Ui24R oder per Zeitlupen-Video. **Bewertung:** Licht gegen den Schlag; Streuung.

### S14 Langer Lauf
- Setlist aus 20 × Referenz-Song (~45 min) ohne Neustart, Gig-Modus, alle Geräte. Drift, Sprünge, Speicher, Akku, Temperatur.

### S15 Server-Varianten
- S3 und S5 mit dem **Dell-Mini-PC** als Server statt des Laptops (später auch Raspberry Pi oder Windows-Gerät, falls Kandidaten).

## 8. Grenzwerte (vor dem Test festgelegt)

| Größe | gut | tragbar | Fehler |
|---|---|---|---|
| Klick minus Track im Gerät (Median) | ≤ 10 ms | ≤ 25 ms | > 25 ms |
| Streuung im Abschnitt | ≤ 5 ms | ≤ 10 ms | > 10 ms |
| Klick A gegen Klick B | ≤ 20 ms | ≤ 40 ms | > 40 ms |
| Drift | ≤ 2 ms/min | ≤ 5 ms/min | > 5 ms/min |
| Sprünge des Tracks | 0 | 1 je Song | mehr |
| Wieder zusammen nach Störung | ≤ 1 Takt | ≤ 4 Takte | mehr |
| Cue gegen Schlag (M1, M2) | ≤ 20 ms | ≤ 50 ms | > 50 ms |
| Pedal bis Reaktion (M3) | ≤ 50 ms | ≤ 100 ms | > 100 ms |
| Licht gegen Schlag (S17) | ≤ 30 ms | ≤ 60 ms | > 60 ms |
| Bildschirm gegen Klick | ≤ 50 ms | ≤ 100 ms | > 100 ms |

Hintergrund: Zwischen Klick und Musik hört man ab etwa 10–20 ms einen „Flam“, ab etwa 30 ms deutlich doppelt; ein Bild wird bis ~50–80 ms als gleichzeitig mit dem Ton empfunden. Bekannte Ausnahme: der Takt mit Tempowechsel **innerhalb** des Takts - berichtet, nicht bewertet.

## 9. Ablauf, Wiederholung, Abbruch

- **3 Läufe** je Fall; das Ergebnis eines Falls ist der Median der drei Läufe, die Spanne der drei zeigt die Wiederholbarkeit.
- **Reihenfolge:** Geräte und Builds wechseln sich ab (ABBA), nicht „erst alles mit main“.
- **Lauf wiederholen**, wenn: > 5 % der Schläge fehlen, ein Kanal übersteuert, ein Gerät eingeschlafen ist, die Rollen falsch gesetzt waren, oder eine unbeabsichtigte Störung auftrat (im Protokoll vermerken).
- **Block abbrechen**, wenn S0 nicht besteht oder der Server Fehler zeigt.

## 10. Auswertung und Darstellung

- Je Lauf sofort: Tabelle je Kanal/Paar und Abschnitt (Median, Mittel, Streuung, Min/Max, Drift, Sprünge), Abgleich mit der Instrumentierung.
- Je Szenario: Median über die Läufe, Spanne, Bewertung nach §8.
- Diagramme: Versatz über die Songzeit je Gerät mit Abschnitten im Hintergrund; Verteilung je Gerät; Geräte-Matrix (Klick A gegen Klick B).
- Ergebnisbericht als Seite (Artifact) und Zusammenfassung in docs/13 §8; Rohdaten außerhalb des Repos (`~/stageboard-measurements/<Datum>/`).

## 11. Was aus den Ergebnissen folgt (Entscheidungsbaum)

| Befund | Folge |
|---|---|
| Versatz im Gerät **konstant**, aber > 25 ms | Ausgleich je Gerät (#302): Klick bzw. Track um den gemessenen Wert verschieben, Werte im Geräteprofil (#303) |
| Versatz **wandert/springt** (Sägezahn, Sprünge) | Track-Nachführung umbauen: sanft über die Abspielgeschwindigkeit statt Sprung bei 200 ms; auf dem Ausgabegerät folgt der Klick der Track-Position (wie im Editor) |
| Editor gut, Solo/Gig schlecht | dasselbe Verfahren wie im Editor auch in Solo/Gig übernehmen |
| Geräte untereinander > 40 ms bei kleinem Versatz im Gerät | Uhrabgleich prüfen (docs/09), Ausgabelatenz je Gerät ausgleichen |
| Ein Gerät dauerhaft schlecht (z. B. Fire) | Geräteprofil: für Klick-Rolle „nicht geeignet“, Hinweis in der App |
| USB-C-Adapter mit großer Verzögerung | Empfehlung für Adapter/Interfaces in der Doku, Wert ins Geräteprofil |
| Bildschirm aus stoppt den Klick | Entscheidung: Wake-Lock erzwingen / Warnung / Hintergrund-Audio (eigenes Issue) |
| Cues zu spät | Cues vorziehen (Ahead-of-time, docs/00 §4) |
| Server-Hardware macht einen Unterschied | Hardware-Empfehlung für die Box |
| Pieps gut, Drums (S13) anders | Auswertung/Analyse prüfen, bevor Maßnahmen ergriffen werden |

## 12. Rollen und Ablauf am Testtag

- **Marco (vor Ort):** Aufbau, Kabel und Pegel am Ui24R, Geräte bereitstellen, Aktionen, die einen echten Finger brauchen (Audio-Freigabe nach Neuladen, Bildschirm aus/an, WLAN aus/an), Zeitlupen-Video.
- **Claude (am Laptop):** Rollen der Geräte setzen und zurücksetzen, Play/Stop per Werkzeug, Aufnahme starten/benennen, Instrumentierung, Auswertung direkt nach jedem Lauf, Protokoll, Bericht.

| Block | Inhalt | Dauer (ca.) |
|---|---|---|
| A | Aufbau, Geräte vorbereiten, S0 Kalibrierung | 1,5 h |
| B | S1, S2 (alle Geräte, main) | 1,5 h |
| C | S3, S4, S5 | 1,5 h |
| D | S11 (#460, App/Browser) | 1,5 h |
| E | S6, S7, S8 | 1,5 h |
| F | S9, S10, S12, S13 | 1,5 h |
| später | S14 (Langlauf), S15 (Dell) | eigene Termine |

Realistisch zwei Termine à 4–5 h (A–C, dann D–F).

## 13. Protokoll und Ablage

- Dateien: `~/stageboard-measurements/<Datum>/<Szenario>_<Fall>_<Build>_<Lauf>.wav` plus `…_meta.json` (Kanalbelegung, Geräte, Versionen, Rollen, Ereignisse) und `…_instr.jsonl` (Instrumentierung).
- Protokoll-Tabelle (eine Zeile je Lauf): Zeit, Szenario, Fall, Build, Lauf, Status (gültig/wiederholt), Bemerkung.
- Ergebnisse: docs/13 §8, Bericht als Artifact.

## 14. Vorher zu bauen (Reihenfolge)

1. **Auswertung für viele Kanäle:** WAV mit 24/32 Bit und vielen Kanälen; Modus „alle Kanäle und Paare“; Klick-gegen-Klick ohne Track; Taktkorrektur aus K2.
2. **Messleitstand:** ein Befehl je Lauf - setzt die Rollen, startet Aufnahme (Ui24R-Kanäle) und Instrumentierung, drückt Play, stoppt am Ende, benennt die Dateien, wertet aus, schreibt das Protokoll; stellt am Ende den Ausgangszustand der Band wieder her.
3. **Instrumentierung** (§6) für alle Geräte gleichzeitig.
4. **Störungs-Auswertung** (S6): „bis wieder zusammen“ aus Ereignissen und Versatz.
5. **Cue-Piepser** (S9): hört auf einen MIDI-Eingang und piept beim Empfang; sendet für M3 zu bekannten Zeiten und piept dabei.
6. **Video-Hilfe** (S10): Anleitung zum Bild-für-Bild-Auswerten, ggf. Werkzeug für die Tonspur im Video.
7. **Bericht:** Diagramme und Tabellen als Seite.

Mit dem Laptop-Monitor (ohne Ui24R, ohne Ton im Raum) lassen sich 1–4 vorab vollständig erproben (Laptop-Chrome bei entsperrtem Bildschirm).

## 15. Offene Fragen an Marco

1. Grenzwerte (§8) so übernehmen?
2. Welche Geräte genau, und ist ein Windows-Tablet dabei?
3. Welche USB-C-Klinkenadapter sind vorhanden (Modell)?
4. Hat der Ui24R freie Eingänge 1–8 für den Test, und ist die Aufnahme pro Kanal vor der Bearbeitung möglich (Einstellung „USB-Abgriff“)?
5. Ist ein echtes MIDI-Gerät (Kemper/MG-30/RC-500) für M4 verfügbar? (M1–M3 gehen mit UMC204HD + UM-ONE.)
6. Termine für die zwei Blöcke.
7. USB-DMX-Wandler (Modell), LED-Scheinwerfer, wie QLC+ und Maestro heute angesteuert werden; wird ein Lichtsensor gelötet?
