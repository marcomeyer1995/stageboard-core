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
| 2026-10-29 | **Gemessen statt nur gefragt** (§7): Messrunde vor dem Lauf (alle Geräte nacheinander, wie „Prüfen“); Lautsprecher über Mikrofon **und** Kopfhörer/In-Ear über Kabel; Interface frei wählbar (Laptop, UMC204HD, Mischpult mit Interface-Funktion), Mikrofon wählbar; Grenzwerte ±15 ms / ±5 ms / alle Klicks; bei Rot „Latenz neu speichern“ und vorbelegte Antwort „Problem“. MIDI-Rückweg und Reaktions-Sensoren später. |

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

## 7. Gemessene Teile

Entscheidungen Marco, 2026-10-29. Baut auf „Messen/Prüfen“ auf (docs/21 §4 und §8.6, #498): ein Gerät spielt 12 Klicks in unregelmäßigem Abstand, der Stage-Server nimmt auf und rechnet aus dem ganzen Muster den Versatz - bisher nur von Hand und je Gerät.

### 7.1 Messrunde vor dem Lauf (Schritt 5a)

- **Wann:** nach „Vorbereiten“, vor „Start“, als eigene Stufe „Messen“ (überspringbar). Die Geräte spielen **nacheinander** je 12 Klicks (~15 s je Gerät) - dasselbe Verfahren wie „Prüfen“, nur für alle Geräte der Band automatisch. Ein Gerät, das nicht antwortet oder dessen Klicks der Server nicht eindeutig findet, steht als „nicht gemessen“ da - der Lauf geht trotzdem.
- **Was:** je Gerät und **aktuellem Ausgabeweg** der Versatz gegen den Schlag mit der gespeicherten Latenz eingerechnet, die Streuung und wie viele der 12 Klicks ankamen.
- **Grenzwerte:** Versatz höchstens ±15 ms, Streuung höchstens ±5 ms, alle Klicks da. Sonst rot.
- **Gebaut (2026-10-30, #662 Schritt 5b):** Knopf „Messen“ beim Master nach „Vorbereiten“. Jedes Gerät, das sich im Gig-Modus meldet, bekommt einen festen Zeitschlitz von 18 s (`lib/rigCheckMeasure.ts`); ohne Übergabe von Gerät zu Gerät, wer nicht da ist, verpasst seinen Schlitz. Ist der Server vom Schlitz davor noch belegt, fragt das Gerät bis zu 3 s lang erneut. „Start“ wartet, bis die Runde vorbei ist.
- Nicht gewählt (vorerst): Messen während des Laufs mit eigener Tonhöhe je Gerät - mehr Aussage (Drift, Aussetzer an Sprung und Pause), aber aufwendiger; später möglich.

### 7.2 Eingänge: Mikrofon und Kabel

- **Beides:** Lautsprecher über ein **Mikrofon**; Kopfhörer, In-Ear und Bluetooth-Empfänger über ein **Kabel** vom Kopfhörer-/Line-Ausgang in einen Eingang. Gemessen wird immer der Ausgabeweg, der gerade steckt (jeder Weg hat seine eigene gespeicherte Latenz, #497).
- **Audio-Interface frei wählbar:** jedes Gerät, das der Stage-Server als Audio-Eingang sieht - das Laptop-Mikrofon (heute `CALIBRATION_AUDIO_DEVICE`), ein **Behringer UMC204HD** (vorhanden), oder ein **Mischpult mit Interface-Funktion**. Allen & Heath CQ-18T meldet sich per USB als Audio-Interface (zu prüfen: Kanalbelegung). Beim Soundcraft Ui24R ist zu prüfen, ob es einen USB-Audioweg zum Rechner gibt - sonst über einen Ausgang des Pults in ein Interface.
- **Eingang je Zweck:** in der Einrichtung des Rig-Checks (System → Rig-Check, nur Admins) ein „Messeingang Mikrofon“ und ein „Messeingang Kabel“: jeweils Gerät und Kanal. Im Bandraum hängen mehrere Mikrofone - eins davon wird gewählt, dazu Pegelanzeige und „Testklick“, damit man sieht, dass etwas ankommt.
- Heute nimmt der Server nur ein festes Gerät per Umgebungsvariable auf; dafür braucht es die Auswahl im Backend (Liste der Eingänge, Kanal wählen).
- **Gebaut (2026-10-30, #662 Schritt 5a):** System → Rig-Check → „Messeingänge“. Der Server listet seine Eingänge (`arecord -l`, Kanäle aus den Hardware-Parametern) und speichert die Wahl in `measure-inputs.json` im Datenverzeichnis, denn das ist seine Hardware, nicht die der Band. Ohne Wahl gilt beim Mikrofon weiter `CALIBRATION_AUDIO_DEVICE`; ein nicht gewähltes Kabel hört wie das Mikrofon. „Messen/Prüfen“ nimmt das Mikrofon beim Lautsprecher (und unbekanntem Weg im Browser), das Kabel bei Kopfhörer, USB und Bluetooth.
- „Pegel prüfen“ hört 2,5 s zu, „Testklick“ spielt dabei 3 Klicks von diesem Gerät. Gemessen am Laptop-Eingang: Der Eingang steht nach dem Öffnen ~0,5 s auf Vollausschlag (Gleichspannung klingt ab). Pegel und Klickzählung lassen deshalb die ersten 600 ms weg (`SETTLE_MS`).

### 7.3 Ergebnis und Urteil

- Im Nachbericht je Gerät: „Klick gemessen: +3 ms (± 1 ms), 12/12“ grün - oder rot mit dem Wert.
- Bei Rot ein Knopf **„Latenz neu speichern“**: übernimmt den gemessenen Wert für diesen Ausgabeweg (wie „Übernehmen“ bei „Messen“).
- Rot **belegt die Antwort vor**: die Frage „Alles in Ordnung?“ öffnet auf diesem Gerät gleich bei „Problem“ mit der Notiz „Klick 40 ms zu spät (gemessen)“ - änderbar, das Urteil bleibt beim Musiker.

- **Gebaut (2026-10-30, #662 Schritt 5c):** Ergebnis in der Geräte-Zeile (Rig-Check und Nachbericht), grün/rot nach den Grenzwerten. Bei Rot mit eindeutigem Wert „Latenz neu speichern (… ms)“ = gespielte Latenz + gemessener Rest, für Gerät und Ausgabeweg. Die Abschlussfrage öffnet auf dem Gerät bei „Problem“ mit vorbelegter Notiz.

### 7.4 Später

- **MIDI-Rückweg:** ein Cue an einen Ausgang, dessen Thru zurück an einen Eingang führt, meldet seine Ankunft - misst die Leitung, nicht das Gerät.
- **Reagiert das Gerät wirklich:** Kemper abwechselnd lauter/leiser Patch, das Mikrofon misst den Pegelsprung; Licht mit Fotodiode (#491), sobald es DMX/OSC-Cues gibt (#484).

## 8. Reihenfolge

1. Dieses Konzept.
2. Song-Generator mit Grundwahrheit (`lib/rigCheckSong.ts`): Abschnitte, Raster, Text, Cues, Beeps, Schlagzeug, WAV - mit Tests gegen `clickTimeline`.
3. System → Rig-Check: Einrichtung (Geräte-Cues), Vorbereiten, Geräte-Liste, Start/Ende, Urteil je Gerät; verborgene Dokumente; Ergebnis im Show-Log und im Nachbericht.
4. Analyse-Prüfung.
5. Gemessene Teile (§7): **5a** Messeingänge im Backend wählbar (Gerät + Kanal, Pegel, Testklick) - **5b** Messrunde vor dem Lauf - **5c** Ergebnis im Nachbericht, „Latenz neu speichern“, vorbelegte Antwort - **später** MIDI-Rückweg und Reaktions-Sensoren (§7.4).

## 9. Offen

- Ui24R als Messeingang: gibt es einen USB-Audioweg zum Rechner (§7.2)?
- Messen während des Laufs (eigene Tonhöhe je Gerät) - später, wenn die Messrunde steht.
- Ob der Rig-Check später auch als Widget auf ein Dashboard darf (Soundcheck-Dashboard) - vorerst nur System.

## Verwandt

docs/13 (Klick-Raster, Beep-Test), docs/14 §5a (Raster mit Ausrichtungspunkten), docs/19 (Track-Wiedergabe), docs/21 (Timing-Klassen und Kalibrierung), docs/23 (Aktionen), #464, #479, #491, #494, #497, #498.
