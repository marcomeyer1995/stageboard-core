# 14 – Timeline-Editor: ein visueller Editor für alles mit Zeitbezug

Stand: 2026-09-27, Konzept vor der Umsetzung (mit Marco abgestimmt). Konkretisiert „Workflow B: Die Timeline“ aus [docs/04](04_Editor_Und_Datenstruktur.md) und baut auf der Tempo-Karte aus [docs/13](13_Klick_Raster_und_Beat_Anker.md) auf.

## 1. Ziel

Ein Song hat viele Dinge mit Zeitbezug – Schläge und Takte, Tempo-Abschnitte, Parts, Liedzeilen, Kommentare, Tab-Blöcke, Cues, das Einzählen. Heute werden sie in getrennten Listen und Tipp-Dialogen bearbeitet, ohne dass man sie gemeinsam gegen die Musik sieht. Der Timeline-Editor zeigt alles auf **einer gemeinsamen Zeitachse** über der Wellenform des Tracks, mit dem berechneten Takt-/Schlagraster als Einrast-Gitter, und macht es dort direkt bearbeitbar.

Entscheidungen (Marco, 2026-09-27):
- **Geräte:** PC (Maus/Tastatur) und Tablet quer (Touch) gleichwertig. **Hochkant läuft die Zeit nach unten** (Spuren als Spalten, liest sich wie ein Liedblatt) – bearbeitbar wie quer.
- **Ort:** eine eigene **Vollbild-Ansicht** des Song-Editors, umschaltbar „Text | Timeline“ (beide auf demselben Entwurf; ursprünglich als Abschnitt in der Detail-Spalte gebaut – zu schmal, Marco 2026-09-27). Die bisherigen Listen (Anker, Tempo-Wechsel, Cues) bleiben für exakte Zahleneingabe. Ein geführter Assistent für neue Songs könnte die Timeline später für seine Zeit-Schritte nutzen – noch nicht entschieden.
- **Reihenfolge:** Phase 1 Raster, Phase 2 Text & Parts, Phase 3 Cues & Kommentare/Tabs – je ein PR mit Tablet-Prüfung.

## 2. Was auf der Zeitachse liegt

| Spur | Inhalt | Gespeichert in | Bearbeiten in der Timeline |
|---|---|---|---|
| Audio | Wellenform des Tracks (Band-Mix, sonst Referenz) | Variante `tracks` | ansehen, ab hier abspielen |
| Raster | Takte/Schläge der berechneten Tempo-Karte, Qualitätsfarbe je Takt, Tempo-Abschnitte, Einzählen vor 0:00 | `beatAnchors`, `tempoMarkers`, `countInEnabled/Bars` | Eins setzen, Taktstrich ziehen, Abschnitte setzen/verschieben, Strecke neu tippen |
| Parts | Verse/Chorus/… als Blöcke | ChordPro (Part-Direktiven) + Zeit-Tags | ansehen (ergibt sich aus den Zeilen) |
| Text | jede Liedzeile als Marker | Zeit-Tags `[mm:ss.xx]` am Zeilenanfang im ChordPro | ziehen, einrasten, Strecke neu tippen |
| Kommentare & Tabs | `{c:}`/`{cc4…}`, `{sot}…{eot}` | ChordPro, an Zeilen gebunden | zwischen Zeilen verschieben, Text/„Sichtbar für“ ändern |
| Cues | MIDI/Licht/Effekt-Aktionen | Variante `cues` (`timeMs`, Zielgerät, Befehl) | hinzufügen, ziehen, bearbeiten, einrasten |

Grundsätze:
- **Kommentare und Tab-Blöcke hängen an Liedzeilen**, nicht an einer freien Zeit – so arbeitet auch der Prompter. In der Timeline stehen sie auf der Zeit ihrer Zeile; Verschieben heißt, sie an eine andere Zeile zu hängen.
- **Das Raster ist berechnet** (docs/13): Anker bleiben Beobachtungen; was man in der Raster-Spur korrigiert, wird als zusätzliche, verbindliche Beobachtung gespeichert (Abschnitt 5).
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
