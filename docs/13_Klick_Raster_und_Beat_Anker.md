# 13 – Klick-Raster und Beat-Anker: Untersuchung und neues Konzept

Stand: 2026-09-27. Auslöser: Der Klick „holpert“, und das Stoppen eines Songs mit Backing-Track war nicht sauber. Diese Datei hält fest, was gemessen wurde, warum die bisherige Verankerung nicht trägt, das neue Konzept (Beobachtungen → berechnetes Raster) und was davon gebaut ist.

## 1. Was gemessen wurde

Alles auf dem Fire-Tablet der Band (CDP über adb, siehe docs/09–11) und gegen die echten Tracks auf dem Stage-Server.

**Wiedergabe-Pfad (behoben, PRs #297–#299):**

| Befund | Messung | Behebung |
|---|---|---|
| Standbild bei jedem Schreibvorgang | ~1,1 s bei Play, wachsend mit Laufzeit (gefilterte PouchDB-Feeds, 118 KB Revisionsverlauf von `show-state`) | #297: ein gemeinsamer ungefilterter Feed (`lib/localChanges.ts`) |
| Gig-Songzeit 2,1 s verspätet | Tablet-Uhr 2126 ms vor dem Server; Master stempelte `Date.now()` | #298: `getServerTime()` in `queue.ts` |
| Klick ungleichmäßig bei konstantem Tempo | Einzähl-Klicks 438–513 ms statt 480 ms (grobe Audio-Uhr, ~20-ms-Schritte) | #299: Umrechnung nur beim Verankern, danach exakt eine Schlaglänge weiter |
| Stop erst nach 0,87 s, dann harter Schnitt + Rücksprung | Umweg über die Datenbank; `pause()` + Seek auf 0 innerhalb 1 ms | #299: Zustand sofort lokal, 60-ms-Ausblendung, kein Seek beim Stop |

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

## 5. Offen

- Visueller Editor (Abschnitt 3.4).
- Automatische Abschnitts-/Bruch-Erkennung (Fermate, ausgelassener Schlag) ohne manuellen Tempo-Marker.
- Qualitätsanzeige zusätzlich gegen die Onsets des Tracks (heute nur aus den Ankern selbst).
- Die drei auffälligen Varianten neu verankern (Highway to Hell, beide What's Up).
- `revs_limit` für `show-state` (docs/12, Risiko 10).

## 6. Methode (wiederverwendbar)

- **Klick-Timing:** `OscillatorNode.prototype.start` per CDP umschreiben und `when`/`currentTime` mitschreiben; Abstände in Audio-Zeit auswerten.
- **Audio-Element:** `play`/`pause`/`currentTime`-Setter wrappen und Ereignisse (`seeking`, `waiting`, …) protokollieren.
- **Anker gegen Audio:** Anker aus der Tablet-IndexedDB exportieren (`by-sequence`, `_doc_id_rev`), Track von `~/stageboard-data/audio/<variante>/<track>` mit `av` dekodieren, perkussive Onsets mit `librosa` (HPSS + `onset_detect`, Hop 128, parabolische Verfeinerung), je Anker nächster Onset in ±70 ms; Kennzahlen: Trefferquote, robuste Streuung, p90, Schlag-zu-Schlag-Jitter (Std. der zweiten Differenz), aufgeteilt nach Songvierteln. Die Referenz ist selbst ungenau (dichte Achtel-Onsets) – nur Unterschiede deutlich über ±2 ms zählen.
