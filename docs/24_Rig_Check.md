# Rig-Check: ein eingebauter Test-Song für die ganze Anlage

Konzept, Stand 2026-10-26, Entscheidungen mit Marco vom 2026-10-21, -22 und -26 (#464). Bündelt, was bisher einzeln geprüft wird (Synchron-Test #494, Latenz „Messen“/„Prüfen“ #498, Ausgabelatenz je Weg #497) zu **einem** Lauf, den jede Band vor dem Gig startet. Löst den ersten Entwurf ab (Generator-Skript in PR #465, geschlossen; Abschnitte und Klangerzeugung daraus übernommen).

## 1. Warum

Vor einem Gig will die Band wissen: **alles in einer Linie, alles im Timing** (Marco, 2026-10-21). Heute geht das nur mit einem echten Song - und dann weiß niemand, wo genau der Schlag sein *sollte*. Der Rig-Check spielt einen Song, dessen Timing bis auf die Probe bekannt ist: jeder Schlag, jeder Taktwechsel, jeder Cue. Damit wird jede Abweichung sichtbar und hörbar, und dieselbe Grundwahrheit prüft auch die Analyse im Timeline-Editor.

## 2. Entscheidungen

| Datum | Entscheidung |
|---|---|
| 2026-10-21 | **In die App eingebaut**: Die App erzeugt Song, Cues und Grundwahrheit selbst - nichts wird mitgeliefert. Der Song steht **nicht in der Bibliothek**, gestartet wird in **System**. |
| 2026-10-21 | **Beurteilung**: die Band prüft mit **Auge und Ohr**. Wo ein Sensor da ist, misst die App zusätzlich und zeigt „OK“ oder „x ms zu spät“ (Server-Mikrofon #498, MIDI-Rückweg, gespeicherte Latenz je Ausgang #497, Synchron-Test #494). |
| 2026-10-21 | **Umfang**: alles, was die Anlage tut. |
| 2026-10-22 | **Kurz + Voll**: Kurzcheck bei jedem Soundcheck (~1 min), voller Lauf nach einem neuen Aufbau (alle Abschnitte, Analyse-Prüfung). |
| 2026-10-22 | **Ergebnis** wie eine Show im Nachbericht (Bibliothek → Shows, markiert „Rig-Check“), mit Versatz je Gerät und was ausgefallen ist - über die Zeit vergleichbar. |
| 2026-10-22 | **Der Master spielt** den Test-Song (Track und Klick) wie im Gig; alle anderen folgen. |
| 2026-10-26 | **Geräte-Cues je Gerät gewählt**: In der Einrichtung des Rig-Checks bekommt jedes Gerät **eine** Aktion aus der Aktionsauswahl (z. B. Kemper Stimmgerät an, RC-500 Patch). Geräte ohne Wahl bleiben unberührt. Bandweit gespeichert. |
| 2026-10-26 | **Track wie ein echter**: Der Master erzeugt den Track einmal und lädt ihn auf den Stage-Server; die anderen laden ihn auf dem normalen Weg. So wird auch der Download geprüft, der Rig-Check zeigt „Track da“ je Gerät. |
| 2026-10-26 | **Kurzcheck-Inhalt**: Einzählen, 8 Takte 120, ein Abschnitts-Sprung, 4 Takte 140, ein `{alert:}` und der Cue jedes Geräts - etwa 45 s. |

## 3. Bedienung

**System → Rig-Check** (eigener Bereich, neben dem Synchron-Test):

1. **Auswahl**: „Kurzcheck (~30 s)“ oder „Voller Lauf (~2¼ min)“.
2. **Geräte-Cues**: eine Zeile je eingerichtetem Gerät mit fertigen Befehlen (wie in der Aktionsauswahl, Bühnentechnik) - „nichts“ oder ein Befehl. Bandweit, nur Admins ändern.
3. **Vorbereiten** (nur der Master): erzeugt den Track (einmal je Generator-Version, danach liegt er auf dem Server) und schreibt Song, Variante und Setliste.
4. **Geräte-Liste live**: je Gerät der Band Name, online, Track da, Uhr-Versatz zum Server, Ausgabeweg (Lautsprecher/Kopfhörer/Bluetooth) und gespeicherte Latenz. Fehlt einem Gerät der Track, steht dort „lädt …“.
5. **Start** (nur der Master, nur wenn gerade keine Show läuft): der Master merkt sich die aktive Setliste und den Song, schaltet auf den Test-Song und drückt Play - wie im Gig, mit Einzählen. Die anderen Geräte folgen, wenn sie im Gig-Modus sind (sonst Hinweis „im Gig-Modus folgen“).
6. **Während des Laufs**: auf jedem Gerät läuft der normale Gig-Bildschirm. Prompter-Zeilen heißen „Takt 1“, „Takt 2“ …, die Abschnitte stehen dabei; Beeps (Tonhöhe je Takt) und Klick sollen zu einem Ton verschmelzen.
7. **Ende**: nach dem letzten Takt stoppt der Song von selbst, der Master stellt die vorige Setliste und den vorigen Song wieder her. Jedes Gerät fragt „Alles in Ordnung?“ - **OK** / **Problem** mit kurzer Notiz. Das ist die Auge-und-Ohr-Beurteilung.
8. **Ergebnis** im Nachbericht (Shows-Tab, Schild „Rig-Check“): je Gerät Versatz, Track da, Cues gesendet/fehlgeschlagen, Urteil und Notiz; beim vollen Lauf zusätzlich die Analyse-Prüfung (§6).

## 4. Der Test-Song

Beide Läufe beginnen mit **2 s Stille** (ein Takt Einzählen bei 120 passt genau) und haben ein Raster mit Ausrichtungspunkten an jedem Abschnitt (docs/14 §5a) - das Klick-Raster der App muss also auf jedem erzeugten Schlag liegen.

**Kurzcheck** (~30 s gespielt - 36 s Track, davon 8 s übersprungen; länger wird er über die Taktzahlen in `QUICK_SECTIONS`):

| Abschnitt | Takte | Tempo | Prüft |
|---|---|---|---|
| Einzählen | 1 | 120 | Einzähl-Logik, Blitz |
| Gleichmäßig 120 | 8 | 120 | Grundversatz Klick/Track, Prompter auf dem Schlag, `{alert:}` in Takt 5, Geräte-Cues in Takt 5 |
| Übersprungen | 4 | 120 | Darf **nie** zu hören/sehen sein - der Master springt am Ende von „Gleichmäßig 120“ darüber (Abschnitts-Sprung #479). Prompter-Text: „Hier falsch – Sprung fehlgeschlagen“ |
| Sprung 140 | 4 | 140 | Sprung auf allen Geräten, Tempowechsel am Taktstrich |
| Schluss | 1 | 140 | Auto-Stopp am Track-Ende |

**Voller Lauf** (~2¼ min gespielt) - die Abschnitte des Referenz-Songs vom 2026-10-09 plus Sprung:

| Abschnitt | Takte | Tempo | Prüft |
|---|---|---|---|
| Gleichmäßig 120 | 16 | 120 | Grundversatz und Drift |
| Ritardando | 8 | 120 → 90 | gleichmäßiges Strecken (#354) |
| Gleichmäßig 90 | 4 | 90 | |
| Sprung auf 140 | 8 | 140 | Tempowechsel am Taktstrich |
| Wechsel im Takt | 6 | 140 → 100 ab Schlag 3 | bekannte Grenze: das Raster setzt Punkte nur an Taktanfänge |
| Dreiviertel | 6 | 100, 3/4 | Betonung, Taktwechsel |
| Übersprungen | 4 | 100, 3/4 | wie im Kurzcheck |
| Pause | 2 | 120 | Stille, Klick läuft weiter |
| Wiedereinstieg | 8 | 120 | Track-Sync nach Stille |
| Schluss | 4 | 120 | Auto-Stopp |

**Klang**: Beeps auf jedem Schlag, Tonhöhe je Takt (300-840 Hz, mindestens 160 Hz weg vom Klick mit 1000/1500 Hz - ein Filter trennt beide, auch wenn sie gleichzeitig klingen), dazu ein synthetisches Schlagzeug (Kick, Snare, Hi-Hat-Achtel) für eine realistische Tempoerkennung. Mono, 16 bit, 44,1 kHz, WAV (~10 MB für den vollen Lauf).

**Text**: je Abschnitt ein Teil (`{part: …}` + `{x_bar: …}`), je Takt eine Zeile mit Zeit-Tag: „Takt 7 · Gleichmäßig 120“. Die `{alert:}`-Zeilen zu bekannten Zeiten.

**Cues**: die gewählte Aktion jedes Geräts als Cue in Takt 5 (Kurzcheck) bzw. Takt 9, am Ritardando, nach dem Sprung und nach der Pause (voller Lauf).

**Grundwahrheit**: Zeit jedes Schlags, Abschnittsanfänge, Takte, die das Raster nicht genau trifft (Wechsel im Takt), Cue- und Alert-Zeiten - alles aus einer reinen Funktion (`lib/rigCheckSong.ts`), Tests prüfen, dass das Klick-Raster der App (`clickTimeline`) jeden Schlag trifft.

## 5. Technik

- **Echte, verborgene Dokumente**: Song `rig-check`, eine Variante je Lauf (`rig-check-quick`, `rig-check-full`) und eine Setliste `rig-check` mit einem Eintrag. Echte Dokumente, damit jede bestehende Stelle sie findet (Klick, Track, Cues, Prompter, Sprung, Nachbericht) - der Rig-Check geht durch **genau dieselbe** Gig-Pipeline wie ein echter Song. Verborgen: Bibliothek, Setlisten-Auswahl, Song-Auswahl, Üben und die Katalog-Warteschlange (ohne aktive Setliste) lassen alles mit `isRigCheckId` weg.
- **Track**: Id `rig-check-v<Generator-Version>`. Vorbereiten erzeugt ihn nur, wenn die Variante ihn noch nicht trägt (`putTrack`: Upload, eigener Cache, Metadaten); eine neue Generator-Version ersetzt ihn.
- **Sprung**: der Master stellt den Sprung von „Gleichmäßig 120“ (bzw. „Dreiviertel“) nach „Sprung 140“ (bzw. „Pause“) bei Start in die Warteschlange (`queueSectionJump`, „am Ende des Abschnitts“) - wie ein Musiker per Pedal.
- **Vorher/Nachher**: der Master merkt sich `activeSetlistId`/`activeEntryId` vor dem Start und stellt sie nach dem Ende wieder her (Stop → zurück). Läuft gerade ein Song, startet der Rig-Check nicht.
- **Ergebnis-Daten** im Show-Log (synchronisiert, wie die anderen Nachbericht-Einträge): die Show des Laufs (`show-started`, `song-played`, `cue-fired` wie immer) plus
  - `rig-check-run` (Master): Lauf, Kurz/Voll, Generator-Version - markiert die Show als Rig-Check;
  - `rig-check-device` (jedes Gerät, eine Id je Lauf und Gerät): Name, Track da, Uhr-Versatz und Streuung, Ausgabeweg, gespeicherte Latenz, Urteil OK/Problem und Notiz.
- **Ältere Geräte** kennen die neuen Event-Typen nicht und lassen sie weg - nichts geht kaputt.

## 6. Analyse-Prüfung (voller Lauf)

Auf dem Gerät, das den Lauf startet, läuft danach die Analyse des Timeline-Editors auf dem erzeugten Track: Tempoerkennung, Schlag-Verfolgung (Verfeinern, #517-#520). Verglichen wird mit der Grundwahrheit **je Abschnitt**: mittlere und größte Abweichung der erkannten Schläge, Tempo-Fehler, Treffer in Prozent (≤ 15 ms). „Wechsel im Takt“ ist als bekannte Grenze markiert. Das Ergebnis steht im Nachbericht neben den Geräten - so fällt eine Verschlechterung der Analyse nach einem Update sofort auf.

## 7. Gemessene Teile (später)

- **Server-Mikrofon** (#498): während des Laufs nimmt der Stage-Server auf; aus den Beeps (Tonhöhe je Takt) und dem Klick je Gerät ergibt sich der Versatz jedes Geräts gegen die Server-Zeit - wie „Prüfen“ im Geräte-Tab, aber für alle Geräte in einem Lauf. Mehrere Geräte gleichzeitig trennt erst eine Kennung je Gerät (eigene Tonhöhe oder Zeitfenster) - offen.
- **MIDI-Rückweg**: ein Cue an einen Ausgang, dessen Thru zurück an einen Eingang führt, meldet seine Ankunft.
- **Lichtsensor** (#491): sobald es DMX/OSC-Cues gibt (#484).

## 8. Reihenfolge

1. Dieses Konzept.
2. Song-Generator mit Grundwahrheit (`lib/rigCheckSong.ts`): Abschnitte, Raster, Text, Cues, Beeps, Schlagzeug, WAV - mit Tests gegen `clickTimeline`.
3. System → Rig-Check: Einrichtung (Geräte-Cues), Vorbereiten, Geräte-Liste, Start/Ende, Urteil je Gerät; verborgene Dokumente; Ergebnis im Show-Log und im Nachbericht.
4. Analyse-Prüfung.
5. Gemessene Teile (§7).

## 9. Offen

- Mehrere Geräte gleichzeitig über das Server-Mikrofon unterscheiden (§7).
- Ob der Rig-Check später auch als Widget auf ein Dashboard darf (Soundcheck-Dashboard) - vorerst nur System.

## Verwandt

docs/13 (Klick-Raster, Beep-Test), docs/14 §5a (Raster mit Ausrichtungspunkten), docs/19 (Track-Wiedergabe), docs/21 (Timing-Klassen und Kalibrierung), docs/23 (Aktionen), #464, #479, #491, #494, #497, #498.
