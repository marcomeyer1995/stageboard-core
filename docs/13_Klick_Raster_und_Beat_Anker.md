# 13 – Klick-Raster und Beat-Anker: Untersuchung und neues Konzept

Stand: 2026-09-27. Auslöser: Der Klick „holpert“, und das Stoppen eines Songs mit Backing-Track war nicht sauber. Diese Datei hält fest, was gemessen wurde, warum die bisherige Verankerung nicht trägt, das neue Konzept (Beobachtungen → berechnetes Raster) und was davon gebaut ist.

## 1. Was gemessen wurde

Alles auf dem Fire-Tablet der Band (CDP über adb, siehe docs/09–11) und gegen die echten Tracks auf dem Stage-Server.

**Wiedergabe-Pfad (behoben, PRs #297–#299):**

| Befund | Messung | Behebung |
|---|---|---|
| Standbild bei jedem Schreibvorgang | ~1,1 s bei Play, wachsend mit Laufzeit (gefilterte PouchDB-Feeds, 118 KB Revisionsverlauf von `show-state`) | #297: ein gemeinsamer ungefilterter Feed (`lib/localChanges.ts`) |
| Gig-Songzeit 2,1 s verspätet | Tablet-Uhr 2126 ms vor dem Server; Master stempelte `Date.now()` | #298: `getServerTime()` in `queue.ts` |
| Klick ungleichmäßig bei konstantem Tempo | Einzähl-Klicks 438–513 ms statt 480 ms. Die Audio-Uhr des Tablets (`currentTime`) springt in 64-ms-Schritten, teils 128/192 ms (Ausgabelatenz 260 ms) | #299: Umrechnung nur beim Verankern, danach exakt eine Schlaglänge weiter. Nach dem Deploy noch Sprünge alle paar Schläge (340/450 statt 389 ms): eine Rohablesung lag bis ~130 ms daneben, über der 50-ms-Toleranz → Nachfolge-PR: geglättete Audio-Uhr (obere Hüllkurve von `currentTime − Wanduhr` über ~2 s) |
| Stop erst nach 0,87 s, dann harter Schnitt + Rücksprung | Umweg über die Datenbank; `pause()` + Seek auf 0 innerhalb 1 ms | #299: Zustand sofort lokal, 60-ms-Ausblendung, kein Seek beim Stop |

**Audio-Uhr verschiedener Geräte** (Messseite im Band-WLAN, 5 s je Gerät, eingebauter Lautsprecher, 2026-09-27). Maßgeblich ist „veraltet im 50-ms-Takt“ – so oft liest der Klick-Scheduler die Uhr:

| Gerät | Browser | Uhr-Schritt | veraltet im 50-ms-Takt (Median / max) | Ablesungen > 50 ms veraltet | Ausgabelatenz |
|---|---|---|---|---|---|
| Fire HD 10 (Bühnen-Tablet) | Silk 138, Android 9 | 64 ms | 30 / 61 ms | 20 % | 136 ms (vorher 260) |
| Xiaomi Tablet | Chrome 153, Android | 16 ms | 3 / 5 ms | 0 % | 40 ms |
| Xiaomi Handy | Chrome 154, Android | 16 ms | 3 / 5 ms | 0 % | 40 ms |
| Samsung Handy | Chrome 154, Android | 16 ms | 2 / 5 ms | 0 % | 24 ms |
| Laptop (Stage-Server-PC) | Chrome 154, Linux | 10,7 ms | 6 / 11 ms | 0 % | 32 ms |

Das Fire-Tablet ist der Ausreißer (4–6× gröbere Uhr, 3–6× höhere Ausgabelatenz); die geglättete Audio-Uhr ist dort nötig, auf den anderen Geräten unschädlich. Kurze Uhr-Stillstände gibt es auch anderswo (Xiaomi Tablet einmal 228 ms, Xiaomi Handy 162 ms in der Bild-für-Bild-Messung). Für Tablets, die Klick oder Backing-Track selbst ausgeben, ist das Fire wegen der Latenz die schlechteste Wahl.

**Die Anker selbst (Hauptproblem):** 10 Varianten mit Beat-Ankern, jeweils gegen die perkussiven Onsets des Tracks gemessen (nächster Onset in ±70 ms als Referenz; diese Referenz ist selbst nur auf ±20–30 ms genau).

- **Gleichmäßiges Rauschen:** Wie ein schützender Engel, Rebell Yell, Bohemian Rhapsody u. a. haben einen Anker pro Schlag mit ±20–30 ms Streuung. Der Abstand zwischen zwei Klicks änderte sich von Schlag zu Schlag um 9–42 ms – das hörbare Holpern. Ein geglättetes Raster liegt **genauso nah an den Drum-Hits** (±2 ms, innerhalb der Messgenauigkeit): die Streuung ist Tap-/Erkennungsrauschen, kein echtes Timing.
- **Doppelte Anker:** Highway to Hell (86 Anker 120–200 ms nach dem echten Schlag), What's Up (34). Der alte Duplikat-Filter griff nur unter 150 ms; der Rest wurde zu 170-ms-„Schlägen“. Eine Ursache: eine neue Tap-Session wurde zu den vorhandenen Ankern **addiert**.
- **Falsches Nenn-Tempo:** What's Up hat 127,5 BPM eingetragen, spielt aber ~134–136. Die Schlagzählung zwischen Ankern rundete mit dem Nenn-Tempo und war dadurch unsicher.
- **Lücken / verpasste Schläge:** What's Up (Auto: music-tempo) – Anker nur alle ~4 Schläge, teils 5, 9, 30 Schläge Abstand.
- **Falsche Taktposition:** What's Up (Original) – 164 Anker widersprechen der Mehrheit; der betonte Klick saß stellenweise auf der falschen Zählzeit.
- **Tempo-Drift:** innerhalb eines Songs wandert das Tempo nur um 1–3 % (Bohemian Rhapsody ~10 %, echte Abschnitte) – ein einziges festes Tempo läge aber am Ende 75–280 ms daneben.

Anker entstehen durch Tippen **und** durch automatische Erkennung; beide liefern verrauschte Eingaben.

## 2. Wie die Verankerung bisher funktionierte

`metronome.ts` `resolveBeatGrid`: Der jeweils letzte Anker vor der aktuellen Zeit ist der Ursprung; die Lücke zum nächsten Anker wird per Nenn-Tempo in eine ganze Zahl Schläge geteilt und exakt darauf gestreckt (`correctionRatio`). Mit einem Anker pro Schlag ist jede Lücke ein eigenes Segment – der Klick folgt jedem Anker samt seinem Rauschen. Tempo-Marker (#141) teilen den Song in Segmente mit eigenem Tempo und setzen an jeder Grenze einen synthetischen Anker auf Zählzeit 1 (harter Wechsel). Einzählen: `countInBars` Takte vor dem ersten Anker, im Tempo der ersten Lücke. Die Live-Tempo-Korrektur wirkt nur auf das Nenn-Tempo von Segment 0.

## 3. Neues Konzept: Beobachtungen → berechnetes Raster

**Kernidee:** Getippte und erkannte Anker sind **Beobachtungen**, keine Befehle. Daraus berechnet die App ein Raster, und nur dieses Raster spielt der Klick (sowie Einzählen, Visueller Metronom, Statusleiste).

1. **Tempo-Karte:** Abschnitte (an Tempo-Markern), je Abschnitt ein gleichmäßiges Raster, das langsamer Drift folgt, aber nicht dem Rauschen einzelner Schläge. Harte Wechsel nur an Abschnittsgrenzen.
2. **Entstehung:** Automatisch erkennen → Raster rechnen → Eins setzen (das Einzige, was Audio nicht zuverlässig weiß) → nur wo nötig nachtippen. Getippte Anker **ersetzen** die vorhandenen in ihrem Bereich.
3. **Qualitätsanzeige** je Song im Editor, damit Songs mit schlechten Ankern vor der Bühne auffallen.
4. **Visueller Editor** (geplant): Wellenform mit Takt-/Schlagraster, Drum-Hits, Farbe je Takt; Taktstrich ziehen, Abschnitte setzen, mit Klick probehören.

## 4. Was gebaut ist (Schritt 1)

- **`lib/tempoMap.ts` `fitTempoMap`:** Duplikate unter 2/3 Schlag raus (der besser zum Raster passende bleibt); Schläge zwischen Beobachtungen mit dem **lokal gemessenen** Tempo zählen (nicht dem Nenn-Tempo); robuste lokale Regression (LOESS, ±6 Schläge, Bisquare-Neugewichtung mit Mindestskala 40 ms) liefert einen Schlag pro Zählzeit; Eins per Mehrheitsentscheid über die gespeicherten Taktpositionen; Raster läuft garantiert vorwärts (≥ ½ Schlag). Getrennt je Tempo-Marker-Abschnitt. Unter 4 Ankern werden die Anker unverändert gespielt. Gespeicherte Anker bleiben unangetastet; `playbackAnchors()` liefert das Raster, gecacht je Anker-Array (0,7–2,3 ms pro Song).
- Alle Wiedergabe-Stellen lesen `playbackAnchors()` statt der rohen Anker: Klick, Einzähl-Vorlauf (Gig und Solo), Takt-Verlängerung, Visueller Metronom, Statusleiste, Songlänge.
- **`mergeTappedAnchors`:** Tap-Session ersetzt die Anker im getippten Bereich (± ½ Schlag).
- **`TempoMapQualityNote`** im Song-Editor: Urteil gut / prüfen / unzuverlässig, gemessenes Tempo und Spanne, Streuung, doppelte Anker, Ausreißer, unklare Lücken, längste Lücke, widersprüchliche Taktpositionen; bei ≥ 2 % Abweichung Knopf „gemessenes Tempo übernehmen“.

**Validierung gegen die Drum-Hits (10 Varianten):** Das Holpern (Änderung des Schlagabstands von Schlag zu Schlag) sinkt von 9–1048 ms auf ~1–13 ms; der Abstand zu den Drum-Hits bleibt innerhalb der Messgenauigkeit gleich (±2 ms), bei „Were not gonna take it“ steigt die Trefferquote von 62 auf 71 % (fehlende Schläge ergänzt). Urteile: gut – 7, prüfen – Highway to Hell (88 doppelte Anker), unzuverlässig – beide What's-Up-Varianten (Tempo ~5 % daneben, unklare Lücken, 164 widersprüchliche Taktpositionen).

**Nachmessung auf dem Fire nach #300/#301** („All the small things“, Gig, 30 s): Einzählen exakt 389 ms, Stop nach 101 ms; im Song folgten die Klicks dem berechneten Raster, zeigten aber (a) einen Knick im Raster selbst (339/461 ms) – im Intro liegt nur alle 8 Schläge ein Anker, und das Anpassungsfenster wuchs in Sprüngen (±6 → ±12 → ±24 Schläge) – und (b) ±25 ms Streuung in den ersten Sekunden, weil der Scheduler an jedem neuen Rasterpunkt die Audio-Uhr neu ablas. Behoben: das Fenster wächst stetig bis zum 4.-nächsten Anker; beim Übergang zum nächsten Rasterpunkt rechnet der Scheduler vom zuletzt geplanten Klick weiter (neue Uhr-Ablesung nur bei Start, Stillstand oder Sprung).

## 5. Offen

- **Nachtrag 2026-09-27 abends:** Die Bearbeitung über Anker + geglättete Tempo-Karte war im Editor nicht verständlich (Marco). Nachfolger: **starres Raster mit Ausrichtungspunkten** – Tempo konstant zwischen wenigen selbst gesetzten Takt-Punkten, keine Glättung – siehe [docs/14 §5a](14_Timeline_Editor.md#5a-raster-modell-neu-starres-lineal-mit-ausrichtungspunkten). Die Tempo-Karte dieses Dokuments spielt weiter für Varianten ohne das neue Raster, bis alle Songs neu aufgebaut sind.
- Visueller Editor (Abschnitt 3.4).
- Automatische Abschnitts-/Bruch-Erkennung (Fermate, ausgelassener Schlag) ohne manuellen Tempo-Marker.
- Qualitätsanzeige zusätzlich gegen die Onsets des Tracks (heute nur aus den Ankern selbst).
- Die drei auffälligen Varianten neu verankern (Highway to Hell, beide What's Up).
- `revs_limit` für `show-state` (docs/12, Risiko 10).

## 6. Methode (wiederverwendbar)

- **Ausgabe-Latenz per Mikrofon (2026-09-28, §7):** jedes Gerät spielt Piep-Paare auf dieselbe Songzeit (Uhr über `GET /time` wie `clockSync.ts`) – einen über Web Audio (Klick-Pfad), einen in einer erzeugten WAV über `<audio>` (Track-Pfad). Jedes Paar und jedes Gerät bekommt eigene Tonhöhen (je 10 Stufen im Abstand von 60 Hz, alle 1,2 s), sonst ist die Zuordnung bei periodischen Pieps mehrdeutig (−174 ms und +326 ms sehen bei 500 ms Takt gleich aus – so ist die erste Messung falsch herum ausgefallen). Aufnahme mit dem Laptop-Mikrofon (`arecord`), Auswertung: Bandpass ±20 Hz je Tonhöhe, Einsatz bei halber Spitzenhöhe. Die WAV muss länger sein als die Messung, sonst „korrigiert“ die Positionsnachführung am Dateiende scheinbar dauernd.

- **Klick-Timing:** `OscillatorNode.prototype.start` per CDP umschreiben und `when`/`currentTime` mitschreiben; Abstände in Audio-Zeit auswerten.
- **Audio-Uhr des Geräts:** `new AudioContext()`, `currentTime` pro Frame gegen `performance.now()` mitschreiben → Schrittweite (Fire: 64 ms) und Streuung der Zuordnung (126 ms); `baseLatency`/`outputLatency` mit ausgeben.
- **Audio-Element:** `play`/`pause`/`currentTime`-Setter wrappen und Ereignisse (`seeking`, `waiting`, …) protokollieren.
- **Anker gegen Audio:** Anker aus der Tablet-IndexedDB exportieren (`by-sequence`, `_doc_id_rev`), Track von `~/stageboard-data/audio/<variante>/<track>` mit `av` dekodieren, perkussive Onsets mit `librosa` (HPSS + `onset_detect`, Hop 128, parabolische Verfeinerung), je Anker nächster Onset in ±70 ms; Kennzahlen: Trefferquote, robuste Streuung, p90, Schlag-zu-Schlag-Jitter (Std. der zweiten Differenz), aufgeteilt nach Songvierteln. Die Referenz ist selbst ungenau (dichte Achtel-Onsets) – nur Unterschiede deutlich über ±2 ms zählen.

## 7. Ausgabe-Latenz je Gerät: Klick- und Track-Pfad (2026-09-28, nur notiert)

**Anlass:** In der Timeline auf dem Fire kam der Klick hörbar nach dem roten Strich, am Linux-Laptop war er auf den Punkt. Das Raster und die Klick-Logik stimmen – die Verzögerung liegt in der Audio-Ausgabe der Geräte.

**Gemessen** (Methode §6; Laptop, Xiaomi-Tablet 24075RP89G, Fire HD 10; Lautsprecher, alle auf dieselbe Songzeit): Jedes Gerät hat zwei getrennte Verzögerungen – Klick (Web Audio) und Backing-Track (`<audio>`-Element) –, bezogen auf einen gemeinsamen Nullpunkt etwa:

| Gerät | Klick | Track | Browser meldet (`outputLatency` + `baseLatency`) |
|---|---|---|---|
| Laptop (Chrome) | ~30 ms | ~35 ms | 45–50 ms |
| Xiaomi (Chrome) | ~45 ms | ~205 ms | 45 ms |
| Fire HD 10 (Silk) | ~410 ms | ~315 ms | 203 ms |

- Der **Klick-Pfad ist je Gerät konstant** (±3 ms über vier Läufe): mit den gemessenen Werten vorgezogen lagen die Klicks aller drei Geräte innerhalb von 2–5 ms.
- Der **Track-Pfad** hat je Gerät eine große feste Verzögerung plus **±12–17 ms Streuung von Start zu Start**; vorziehen bringt die Tracks auf etwa ±15–20 ms zusammen, nicht genauer.
- Der **Browser-Wert taugt nicht als Ersatz:** er erfasst nur den Klick-Pfad und auch den nicht verlässlich (Fire: 203 ms gemeldet, ~410 ms gehört); für den Track-Pfad meldet kein Browser etwas. „Klick um `outputLatency` vorziehen“ (#302, ursprünglicher Vorschlag) hätte auf dem Xiaomi den Abstand vergrößert (Klick dort schon 90 ms vor dem eigenen Track).
- Ohne Ausgleich: Klick gegen eigenen Track Fire +150 bis +190 ms, Xiaomi −90 ms, Laptop +30 ms; Tracks zwischen den Geräten bis ~280 ms auseinander. Die 200-ms-Nachführung des Tracks (`syncLocalTrackPosition`) hat in keinem Lauf eingegriffen.
- Noch unbekannt: der absolute Bezug dieses gemeinsamen Nullpunkts zur Songzeit (also zu Bildschirm, Licht, MIDI).

**Entscheidung (Marco, 2026-09-28):** pragmatisch bleiben – notieren, nicht weiter untersuchen. Eine Kalibrierung per Mikrofon ist auf der Bühne kaum praktikabel, und dort spielen die Geräte über den Kopfhörer-/Line-Ausgang (Klinke) statt Lautsprecher, mit womöglich ganz anderer Verzögerung. Zuerst im echten Einsatz prüfen, ob der Versatz überhaupt stört.

**Offen, ebenfalls zu untersuchen** (mit der Frage, ob und wie man kalibriert):
- Latenz über Klinke/Line-Out, Audio-Interfaces und Bluetooth-Kopfhörer je Gerät.
- Latenz **zu** externen Zielen: Licht (Stage-Server → DMX/Art-Net), Effektgeräte/Amp-Modeller (MIDI-Befehle an Kemper, MG-30 …).
- Latenz **von** externen Quellen: MIDI-Fußschalter, Bluetooth-Fußschalter (Tastendruck → Aktion in der App).
