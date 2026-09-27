# 14 – Timeline-Editor: ein visueller Editor für alles mit Zeitbezug

Stand: 2026-09-27, Konzept vor der Umsetzung (mit Marco abgestimmt). Konkretisiert „Workflow B: Die Timeline“ aus [docs/04](04_Editor_Und_Datenstruktur.md) und baut auf der Tempo-Karte aus [docs/13](13_Klick_Raster_und_Beat_Anker.md) auf.

## 1. Ziel

Ein Song hat viele Dinge mit Zeitbezug – Schläge und Takte, Tempo-Abschnitte, Parts, Liedzeilen, Kommentare, Tab-Blöcke, Cues, das Einzählen. Heute werden sie in getrennten Listen und Tipp-Dialogen bearbeitet, ohne dass man sie gemeinsam gegen die Musik sieht. Der Timeline-Editor zeigt alles auf **einer gemeinsamen Zeitachse** über der Wellenform des Tracks, mit dem berechneten Takt-/Schlagraster als Einrast-Gitter, und macht es dort direkt bearbeitbar.

Entscheidungen (Marco, 2026-09-27):
- **Geräte:** PC (Maus/Tastatur) und Tablet quer (Touch) gleichwertig. **Hochkant läuft die Zeit nach unten** (Spuren als Spalten, liest sich wie ein Liedblatt) – bearbeitbar wie quer.
- **Ort:** eine eigene **Vollbild-Ansicht** des Song-Editors, umschaltbar „Text | Timeline“ (beide auf demselben Entwurf; ursprünglich als Abschnitt in der Detail-Spalte gebaut – zu schmal, Marco 2026-09-27). Die bisherigen Listen (Anker, Tempo-Wechsel, Cues) bleiben für exakte Zahleneingabe. Ein geführter Assistent für neue Songs könnte die Timeline später für seine Zeit-Schritte nutzen – noch nicht entschieden.
- **Reihenfolge:** Phase 1 Raster, Phase 2 Text & Parts, Phase 3 Cues & Kommentare/Tabs – je ein PR mit Tablet-Prüfung.
- **Raster-Modell (Marco, 2026-09-27 abends):** Die Anker-/Glättungs-Bearbeitung aus Phase 1 ist „viel zu kompliziert, nicht intuitiv“. Ersetzt durch ein **starres Raster mit Ausrichtungspunkten** (Abschnitt 5a). Bestehende Songs werden **nicht umgewandelt** – Marco baut sie neu auf.

## 2. Was auf der Zeitachse liegt

| Spur | Inhalt | Gespeichert in | Bearbeiten in der Timeline |
|---|---|---|---|
| Audio | Wellenform des Tracks (Band-Mix, sonst Referenz) | Variante `tracks` | ansehen, ab hier abspielen |
| Raster | Takte/Schläge des starren Rasters, Ausrichtungspunkte, Tempo je Strecke, Qualitätsfarbe je Takt, Taktart-Wechsel, Einzählen vor 0:00 | `beatGrid` (neu, 5a), `countInEnabled/Bars`; alt: `beatAnchors`, `tempoMarkers` | Takt 1 setzen, Tempo tippen, Taktstrich auf den Hit ziehen (= Ausrichtungspunkt) |
| Parts | Verse/Chorus/… als Blöcke | ChordPro (Part-Direktiven) + Zeit-Tags | ansehen (ergibt sich aus den Zeilen) |
| Text | jede Liedzeile als Marker | Zeit-Tags `[mm:ss.xx]` am Zeilenanfang im ChordPro | ziehen, einrasten, Strecke neu tippen |
| Kommentare & Tabs | `{c:}`/`{cc4…}`, `{sot}…{eot}` | ChordPro, an Zeilen gebunden | zwischen Zeilen verschieben, Text/„Sichtbar für“ ändern |
| Cues | MIDI/Licht/Effekt-Aktionen | Variante `cues` (`timeMs`, Zielgerät, Befehl) | hinzufügen, ziehen, bearbeiten, einrasten |

Grundsätze:
- **Kommentare und Tab-Blöcke hängen an Liedzeilen**, nicht an einer freien Zeit – so arbeitet auch der Prompter. In der Timeline stehen sie auf der Zeit ihrer Zeile; Verschieben heißt, sie an eine andere Zeile zu hängen.
- **Das Raster ist ein starres Lineal** (Abschnitt 5a): Tempo konstant zwischen zwei Ausrichtungspunkten; was man in der Raster-Spur zieht, ist genau das, was der Klick spielt – keine unsichtbare Glättung. (Vorher, Phase 1: Anker als Beobachtungen, per Regression geglättet, docs/13.)
- Das Feld `timecodes` der Variante wird heute nur mitgeführt; die Zeilen-Zeiten stehen im ChordPro.

## 3. Aufbau

```
 ▶ ■  1:23.4   Raster: Takt ▾   Zoom − +        [Klick] [Tippen: Zeilen ▾]
 ──────────────────────────────────────────────────────────────────────
 Audio   ▁▂▅▇▆▃▂▁▂▅▇▇▆▅▃▂▁▁▂▅▇▆▅▃▂▁▂▃▅▇▆▅▃▂▁▁▂▅▇▆▅▃▂
 Raster  |1 . . . |2 . . . |3 . . . |4 . . .   (grün = auf den Hits)
 Parts   [ Intro          ][ Verse 1                      ][ Chorus
 Text      ◆"We're not gonna"  ◆"take it"      ◆"No, we ain't"
 Komm.                    💬 "leise!" (Marco)
 Cues            ⚡ PC5 Kemper        ⚡ Strobo
```

- **Kopfleiste:** Abspielen/Stopp, Zeit, Einrast-Modus (Takt / Schlag / aus), Zoom, Klick an/aus, Tipp-Ziel (Zeilen / Schläge / Cues).
- **Eine Zeitachse für alle Spuren:** Scrollen, Zoomen, Abspielkopf. Jede Spur ist eine eigene Komponente über derselben Achse (`TimelineAxis` + Spuren), damit später weitere dazukommen (z. B. Loop-Bereiche fürs Üben).
- **Auswahl-Leiste** für das gewählte Element: −1 Schlag / −10 ms / +10 ms / +1 Schlag, Löschen, Bearbeiten – damit genaues Setzen auch mit dem Finger geht.

## 4. Bedienung – Touch und Maus gleichwertig

| Aktion | Touch (Tablet quer) | Maus/Tastatur (PC) |
|---|---|---|
| Abspielkopf setzen | Tipp auf leere Stelle der Achse | Klick |
| Element verschieben | ziehen (Trefferzone ≥ 48 px hoch, ±24 px breit) | ziehen |
| Feinjustieren | Auswahl-Leiste (±10 ms / ±1 Schlag) | Pfeiltasten (Schlag), Shift+Pfeil (10 ms) |
| Kontextmenü | Langdruck | Rechtsklick |
| Zoom | Zwei-Finger-Spreizen, Knöpfe | Strg+Mausrad, Knöpfe |
| Scrollen | Wischen auf der Achse | Mausrad / Ziehen der Achse |
| Abspielen | Knopf | Leertaste |
| Rückgängig | Knopf | Strg+Z / Strg+Umschalt+Z |

**Einrasten** am Takt, am Schlag oder aus – gegen das berechnete Raster. **Tippen beim Abspielen** (docs/04 „Workflow A“) geschieht direkt in der Timeline: das Tipp-Ziel bestimmt, was gesetzt wird; getippte Werte **ersetzen** das Vorhandene in ihrem Bereich (wie die Anker seit #300).

## 5. Phase 1: Grundgerüst + Raster

**Umfang**
- Timeline-Tab mit Achse, Zoom/Scroll, Abspielkopf, Wiedergabe des Tracks mit Klick (lokal im Editor, wie heute Tap-to-Sync über `useTrackClock` – nicht über den Show-Zustand).
- Audio-Spur mit Wellenform.
- Raster-Spur: berechnete Takte/Schläge (`playbackAnchors`), Taktnummern, Tempo-Abschnitte, Einzählen vor 0:00, rohe Anker als dezente Punkte (umschaltbar), **Qualitätsfarbe je Takt** gegen die Onsets des Tracks (grün = Schläge auf den Hits, gelb/rot = daneben).
- Bearbeiten:
  - **Eins setzen:** Schlag antippen → wird Zählzeit 1 (setzt die Taktposition des ganzen Abschnitts).
  - **Taktstrich ziehen:** verschiebt das Raster dort; gespeichert als **fester Anker** (`pinned: true`, neues optionales Feld am `BeatAnchor`). `fitTempoMap` behandelt feste Anker als exakt – das Raster läuft durch sie hindurch, die übrigen Beobachtungen glätten nur dazwischen.
  - **Abschnitt setzen/verschieben/löschen** (Tempo-Marker, mit Tempo und Taktart).
  - **Strecke neu tippen:** Tipp-Ziel „Schläge“, ersetzt die Anker im getippten Bereich.
- Die Qualitätsanzeige aus #300 steht über der Timeline und aktualisiert sich live.

**Technik**
- **Wellenform:** Track einmal dekodieren (`decodeAudioData` auf dem Haupt-Thread ist asynchron), Spitzenwerte in einem Web Worker berechnen (≈ 100 Werte/s, ~50 KB für 4 min), in IndexedDB je Track zwischenspeichern.
- **Onsets** für die Qualitätsfarbe: vorhandene Onset-Analyse (`analyzeOnsetsBlob`) im Worker, ebenfalls zwischengespeichert.
- **Zeichnen:** Wellenform, Raster und Qualitätsfarben auf `<canvas>` (nicht ein DOM-Element je Schlag); DOM nur für die sichtbaren, anfassbaren Marker. Ziel: flüssiges Scrollen auf dem Fire-Tablet.
- **Speichern:** die Timeline arbeitet auf dem Entwurf des Song-Editors (wie alle Tabs); nichts wird während des Ziehens geschrieben, gespeichert wird mit „Speichern“. Rückgängig-Stapel pro Editor-Sitzung.

**Abnahme**
- Die drei als „prüfen/unzuverlässig“ markierten Songs (Highway to Hell, beide What's Up) lassen sich in der Timeline so korrigieren, dass die Qualitätsanzeige „gut“ zeigt.
- Messung gegen die Drum-Hits (Methode docs/13 §6): feste Anker verschlechtern die Nähe zu den Hits nicht.
- Fire-Tablet: Scrollen und Zoomen ohne sichtbares Ruckeln, keine langen Frames > 100 ms beim Öffnen außer dem einmaligen Dekodieren.

**Stand der Umsetzung (2026-09-27):** Phase 1 gebaut (#307) – `components/timeline/TimelineEditor.tsx`, reine Logik in `lib/timeline.ts` (Ansicht, Zoom, Einrasten, Treffer-Test, Qualität je Takt, Raster-Bearbeitung), Analyse in `lib/trackAnalysis.ts` + `trackAnalysisWorker.ts` (Spitzenwerte je 10 ms und Onsets, IndexedDB-Cache `stageboard-timeline-cache`), feste Anker in `fitTempoMap`. Ein gezogener Taktstrich rastet mit Einrasten auf einem Drum-Hit innerhalb von 40 ms ein. Vollbild über den Umschalter „Text | Timeline“ (#308); hochkant vertikal (Zeichnen und Zeiger in Längs-/Quer-Koordinaten, nur Canvas-Transformation, Zeigerkoordinaten und Abspielkopf werden getauscht; Beschriftungen bleiben aufrecht). Tablet-Prüfung und Abnahme stehen aus.

**Arbeitsablauf für einen neuen Song** (so erklärt am 2026-09-27; alles in der Timeline):
1. Im Text-Modus Track anhängen, ungefähres Tempo und Taktart eintragen.
2. Timeline öffnen → **„Track analysieren“** (erste Anker automatisch; ersetzt alle Anker, rückgängig machbar) oder **„Schläge tippen“**. Bietet die Qualitätszeile **„… BPM übernehmen“** an, zuerst das.
3. Herauszoomen, das farbige Qualitätsband ansehen; **„Nächste Problemstelle“** springt zum nächsten roten Takt (gibt es keinen, zum nächsten gelben), zoomt auf ein paar Takte, wählt den Taktstrich und setzt den Abspielkopf dorthin.
4. Mit Klick anhören; Taktstrich auf den Drum-Hit ziehen, ±10 ms feinjustieren, „Hier ist die Eins“ bei verschobener Zählzeit, Strecken ohne brauchbare Anker neu tippen. Band wird grün/gelb → nächste Problemstelle.
5. Nur bei echtem Tempowechsel „Abschnitt ab hier“ (Tempo = Median der folgenden 16 Schläge, danach über „Tempo / Taktart“ prüfen).
6. „Speichern“. Ein guter Song braucht keine festen Anker, ein schwieriger eine Handvoll.
Zum Neuanfang gibt es **„Alle Anker löschen“** in der Timeline (rückgängig machbar) und im Text-Modus unter „Tempo & Klick“ (nur der Entwurf, erst „Speichern“ übernimmt es).

**Fehler aus der Tablet-Prüfung (2026-09-27, „Whats up“):** ein Tempo-Abschnitt ab 0:00 mit 23,8 BPM – „Abschnitt ab hier“ nahm das Tempo aus der einen Lücke nach dem ersten Schlag (die Stille vor dem ersten Hit) –, und ein fester Anker genau auf 0:00, weil ein Schlag vor den Songanfang geschoben und dort auf 0 geklemmt wurde. Mit dem Abschnitt wertete `fitTempoMap` 499 von 579 Ankern als doppelt, das Raster lief mit 16,8 statt 134,7 BPM. Behoben: Abschnittstempo aus dem Median der folgenden Schläge (`sectionBpmAt`); Verschieben vor 0:00 wird abgelehnt statt geklemmt (`pinBeat`, `nudgeAnchor`); ist ein Abschnittstempo viel langsamer als die eigenen Anker (Median-Abstand < 0,4 Schlag), nimmt der Fit deren Abstand und die Qualitätszeile meldet „Abschnitts-BPM prüfen“ (`tempoMismatches`, Urteil „unzuverlässig“).

## 5a. Raster-Modell neu: starres Lineal mit Ausrichtungspunkten

Stand 2026-09-27, Konzept – mit Marco abgestimmt, noch nicht gebaut. Ersetzt die Raster-Bearbeitung aus Phase 1 (Abschnitt 5).

**Warum.** Beim ersten echten Einsatz war die Phase-1-Bearbeitung nicht verständlich: Hunderte Anker, eine unsichtbare Glättung über ±6 Schläge, feste Anker, ±1 Schlag, „Hier ist die Eins“, Tempo-Abschnitte – was ein Zug an einem Taktstrich bewirkt, war nicht vorhersehbar, und ein Fehlgriff (Abschnitt mit 23,8 BPM, fester Anker auf 0:00) machte den Song unbrauchbar, ohne dass man es sah. Marcos Vorschlag: einmal tippen → festes Raster → visuell an die Wellenform anlegen.

**Warum nicht ein einziges festes Tempo.** Die Tracks der Band driften innerhalb eines Songs um 1–3 % (docs/13 §1); ein einziges festes Tempo läge am Songende 75–280 ms daneben – hörbar. Deshalb: festes Tempo **zwischen** wenigen Punkten, die man selbst setzt (Prinzip der Warp-Marker in Ableton Live / Logic).

### Modell

- **Ausrichtungspunkt** = „Takt *n* beginnt genau bei Zeit *t*“. Nur ganze Takte (Zählzeit 1), keine einzelnen Schläge.
- **Zwischen zwei Punkten** ist das Tempo konstant: die Takte dazwischen werden gleichmäßig aufgeteilt. Vor dem ersten und nach dem letzten Punkt läuft das Tempo der angrenzenden Strecke weiter.
- **Nur ein Punkt** (Takt 1): das ganze Lineal läuft im Grundtempo der Variante (`bpm`).
- **Tempowechsel** braucht kein eigenes Element: ein Punkt am Wechsel und einer ein paar Takte später – die Strecken davor und danach haben dann ihr eigenes Tempo. Die Anzeige zeigt das Tempo je Strecke.
- **Taktart-Wechsel** (z. B. ein 2/4-Takt) als eigener Eintrag „ab Takt *n*: 2/4“, weil er die Schlagzählung ändert.
- **Takt 1** ist der Takt, mit dem der Klick nach dem Einzählen beginnt; das Einzählen läuft davor im Tempo der ersten Strecke.

Gespeichert als neues Feld der Variante (shared-types), z. B.

```ts
beatGrid?: {
  points: { id: string; bar: number; timeMs: number }[]      // sortiert, bar ≥ 1, mind. 1 Punkt
  meters?: { bar: number; timeSignature: string }[]          // Taktart ab Takt n (sonst die der Variante)
}
```

Die Wiedergabe liest weiterhin `playbackAnchors(variant)`: mit `beatGrid` liefert sie die Schläge dieses Lineals (reine Rechnung, keine Glättung), ohne `beatGrid` wie bisher die geglättete Tempo-Karte aus den alten Ankern. Klick, Einzählen, Visueller Metronom, Statusleiste und Songlänge müssen dafür nicht angefasst werden.

### Ablauf für einen Song

1. **Takt 1 setzen:** in der Wellenform auf den ersten Hit tippen → „Takt 1 hier“ (oder den Taktstrich 1 dorthin ziehen). Mit Einrasten landet er auf dem Drum-Hit.
2. **Tempo:** „Tempo tippen“ – beim Abspielen 8–16 Schläge irgendwo im Song mittippen; das Tempo ist die Steigung einer Ausgleichsgeraden durch die Tipps. Die Tipp-Latenz des Geräts (Fire 136–260 ms) spielt keine Rolle, weil sie nur verschiebt, nicht streckt, und die Lage aus Schritt 1 kommt. Alternativ Zahl eingeben oder „Track analysieren“.
3. **Ans Ende springen**, letzten gut hörbaren Takt auf seinen Hit ziehen → zweiter Punkt, das Tempo dazwischen wird neu berechnet. Bei zum Klick aufgenommenen Tracks ist man hier fertig.
4. **Qualitätsband** prüfen, „Nächste Problemstelle“: dort den Taktstrich auf den Hit ziehen → weiterer Punkt. Erwartung: 2 Punkte bei Studio-Tracks, 3–6 bei driftenden.
5. **Speichern.**

### Bedienung in der Raster-Spur

- **Nur Taktstriche** sind anfassbar (Schlaglinien nur Anzeige) – groß genug zum Treffen, auch herausgezoomt.
- **Taktstrich ziehen** setzt dort einen Punkt (oder verschiebt ihn, wenn schon einer da ist). Es bewegen sich nur die Takte zwischen dem vorherigen und dem nächsten Punkt, gleichmäßig; alles außerhalb bleibt stehen. Ist es der einzige Punkt, verschiebt sich das ganze Lineal. Ein Taktstrich kann nicht über einen Nachbarpunkt hinaus gezogen werden.
- **Einrasten** auf einen Drum-Hit innerhalb von 40 ms (wie heute), Feinschritte ±10 ms in der Auswahl-Leiste.
- **Punkt antippen:** Takt, Zeit, Tempo davor/danach; „Punkt entfernen“ (die Nachbarstrecken verschmelzen), „Taktart ab hier“.
- **Anzeige:** Punkte als Rauten auf dem Taktstrich, Tempo je Strecke in der Abschnittsleiste („133,2 BPM“), Qualitätsfarbe je Takt wie heute. Kurze Hilfezeile beim ersten Öffnen: „Taktstrich auf den Schlag in der Wellenform ziehen“.
- **Qualitätszeile** statt der Anker-Diagnose: „134,2 BPM · 3 Punkte · 91 % der Takte auf den Hits“.
- **Entfällt:** rohe Anker, feste Anker, „Hier ist die Eins“, ±1 Schlag, „Abschnitt ab hier“ (Tempo), „Alle Anker löschen“ (→ „Raster neu aufbauen“), die Anker-Diagnose. Im Text-Modus ersetzt eine Punkteliste (Takt, Zeit, Tempo) die Anker- und Tempo-Wechsel-Listen für exakte Zahleneingabe.

### Bestehende Songs

Keine automatische Umwandlung (Marco baut sie neu auf). Solange eine Variante kein `beatGrid` hat, spielt sie wie heute aus den alten Ankern; die Timeline zeigt dann „Altes Raster – neu aufbauen“. Beim Aufbau werden `beatAnchors` und `tempoMarkers` der Variante geleert (mit Rückfrage, rückgängig bis zum Speichern). Wenn alle Songs neu aufgebaut sind, fallen Anker-Code und -Listen weg (eigenes Issue).

„Track analysieren“ liefert künftig ebenfalls dieses Modell: aus den erkannten Schlägen ein Lineal mit so wenigen Punkten wie möglich (neuer Punkt nur, wo das Lineal mehr als ~30 ms von den erkannten Schlägen abweicht).

### Umsetzung in drei PRs

1. **Modell + Wiedergabe:** `beatGrid` in shared-types, `lib/beatGrid.ts` (Schläge aus Punkten, Tempo je Strecke, Punkt setzen/verschieben/entfernen mit den Grenzen oben, Tempo aus Tipps), `playbackAnchors` nutzt es. Tests inkl. Einzählen und Taktart-Wechsel.
2. **Timeline:** neue Raster-Spur und Knöpfe (Takt 1 hier, Tempo tippen, Punkt-Auswahl), „Nächste Problemstelle“ bleibt, alte Bedienelemente raus; hochkant gleich. Tablet-Prüfung.
3. **Text-Modus + Analyse:** Punkteliste, „Track analysieren“ → Lineal mit Punkten.

**Abnahme:** Marco baut einen Song mit Studio-Track und einen driftenden (What's Up) in je unter 5 Minuten auf, ohne Erklärung; Messung gegen die Drum-Hits (docs/13 §6) mindestens so nah wie die Tempo-Karte; Fire: Ziehen ohne Ruckeln.

**Offen:** Auftakt vor Takt 1 (Songs, die mit einem unvollständigen Takt beginnen) – als Takt 0 mit weniger Schlägen oder über das Einzählen? Wird beim ersten solchen Song entschieden.

## 6. Phase 2: Text & Parts

- Text-Spur: jede Liedzeile mit Zeit-Tag als Marker (Anfang der Zeile, Text gekürzt); Zeilen ohne Zeit-Tag gesammelt am Rand mit „noch nicht gesetzt“.
- Ziehen mit Einrasten schreibt den Zeit-Tag der Zeile im ChordPro; Reihenfolge der Zeilen bleibt (ein Marker kann nicht an seinen Nachbarn vorbei).
- Tipp-Ziel „Zeilen“: ersetzt die Zeit-Tags der im Bereich getippten Zeilen (heutiges Tap-to-Sync, aber für eine Strecke statt immer den ganzen Song).
- Parts-Spur: Blöcke aus den Part-Direktiven, Grenzen an der ersten Zeile des Parts.

## 7. Phase 3: Cues & Kommentare/Tabs

- Cue-Spur: Cues als Marker mit Symbol je Zielgerät; hinzufügen (Doppeltipp/Doppelklick), ziehen, bearbeiten (Zielgerät, Befehl – wie `CueListEditor`), einrasten; Tipp-Ziel „Cues“ nutzt den vorhandenen Cue-Recorder.
- Kommentar-Spur: Kommentare und Tab-Blöcke auf der Zeit ihrer Zeile; Verschieben hängt sie an eine andere Zeile; Text und „Sichtbar für“ im Auswahl-Menü (wie `CommentListEditor`).

## 8. Später

Loop-Bereiche für den Loop-Trainer aus einer Auswahl; Übergänge/Song-Ende sichtbar machen; Akkorde als Nur-Lese-Spur.

## 9. Risiken und offene Punkte

- **Latenz beim Tippen** (docs/13, #302): auf dem Fire-Tablet hört man 136–260 ms später, getippte Zeiten liegen entsprechend zu spät. Bis #302 umgesetzt ist, zeigt die Timeline beim Tippen auf solchen Geräten einen Hinweis.
- **Speicher beim Dekodieren** langer Tracks auf dem Fire-Tablet: Spitzenwerte in Blöcken berechnen, dekodierte Daten danach verwerfen.
- **Schema:** `BeatAnchor.pinned` ist optional – ältere Clients ignorieren es und spielen solche Anker als normale Beobachtungen.
- **Gleichzeitiges Bearbeiten** derselben Variante auf zwei Geräten: wie heute gewinnt der letzte Speichervorgang; die Timeline zeigt einen Hinweis, wenn die Variante seit dem Öffnen woanders geändert wurde.
