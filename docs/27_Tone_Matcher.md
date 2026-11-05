# Tone Matcher: Gitarren-Sound aus einem Referenz-Track

Konzept, Stand 2026-11-03, mit Marco besprochen. Kein Beschluss. Ausgangspunkt war eine (KI-geschriebene) Spezifikation eines „Autonomous Hardware-in-the-Loop Guitar Tone Matcher“: Kemper Profiler und NUX MG-30 sollen über USB automatisch so eingestellt werden, dass sie wie die Gitarre in einem Referenz-Song klingen. Erster Schritt ist die Qualität der Gitarren-Spur (#681), weil sie das Ziel ist, gegen das der Matcher vergleicht.

## 1. Die Spezifikation in Kürze

- **Ablauf:** Gitarre im Referenz-Song finden (isolierte Stelle oder Stem-Trennung) → eigenes DI-Signal einspielen → über USB durch das Gerät schicken und das Ergebnis aufnehmen → Abstand messen (Crest-Faktor für die Verzerrung, Spektrum in 48 Bändern 80 Hz–5,5 kHz, Anschlag) → Regler nachstellen, bis der Abstand klein ist.
- **Drei Wege:** A Impulsantwort (Box) direkt berechnen und hochladen, B Regler (Tonestack, EQ) per Bayes-Optimierung in ~45 Durchläufen suchen, C NAM-Modell eines eigenen Pedals trainieren und ins MG-30 laden.
- **Raum-Effekte** (Delay, Hall, Modulation) aus Pausen und Ausklängen messen und setzen.

## 2. Passt es zu StageBoard?

**Ja, als Vorbereitungs-Plugin.**

- Muster gibt es schon: das Plugin „Spuren trennen“ (`stemSeparationPlugin.ts`) startet ein Python-Skript als Hintergrund-Job (`asyncJobWatcher.ts`). Der Matcher wäre genauso ein Plugin mit einem schwereren Python-Job – nicht der eigene FastAPI-Daemon mit eigenem Protokoll aus der Spezifikation.
- Das Ergebnis passt ins Bestehende: ein Preset je Song, das beim Songwechsel als Cue ans Gerät geht.
- Nur in der Vorbereitung (Home-Sandbox), nie im Gig erreichbar.
- Emulatoren für Kemper und MG-30 gibt es (`~/Device Emulators`).

**Was nicht passt bzw. offen ist:**

- **Wo das Gerät hängt:** heute am Tablet (WebMIDI). Der Matcher braucht USB-Audio und MIDI am Rechner mit Python, also am Stage-Server oder einem Laptop (vgl. Host-Idee docs/25).
- **Unbelegte Hardware-Annahmen der Spezifikation**, vor dem Bauen prüfen: hat der Kemper USB-Audio (nach bisherigem Wissen nicht – dann geht „ohne Interface“ beim Kemper nicht)? Lässt sich beim Kemper eine Impulsantwort per SysEx laden (bisher nur über Rig Manager bekannt)? Gibt es das „MG-30 GEN2“ mit NAM-Speicherplätzen und einen dokumentierten Weg, Modelle hochzuladen?
- **Weg C** braucht für ein eigenes Pedal doch einen Reamp-Aufbau, und NAM-Training auf der CPU dauert Stunden.
- **Ob der Kern überhaupt trägt** (eigenes DI gegen eine getrennte Gitarre aus einem fertigen Mix), ist unbewiesen. Erst offline gegen Grundwahrheit prüfen, dann bauen.

## 3. Schritt 1: Gitarren-Spur (#681)

Die heutige Gitarren-Spur (`htdemucs_6s`, „Erweitert“) klingt gedämpft, rauscht und hat Übersprechen. Für den Matcher ist sie das Ziel-Spektrum; jeder Trennfehler landet direkt im Ergebnis.

### 3.1 Aufbau des Tests

- **Grundwahrheit:** 7 Multitracks von Cambridge-MT (nur Lehre/Test, nicht kommerziell), keiner davon in MUSDB18 (Trainingsdaten fast aller Modelle). Gemischt nach einfachen Regeln (Pegel, Panorama), Bus-Kompressor und Limiter auf ~−10,6 LUFS; die Gitarren-Summe ist exakt bekannt.
- **Echte Platten zum Hören:** 4 Originale aus der Abadschendaler-Bibliothek (Highway to Hell, Breaking the Law, When I Come Around, Tush). Ohne Grundwahrheit, nur fürs Ohr. Die Dateien sind ~128 kbit/s AAC/Opus (YouTube-Qualität) – das macht die Gitarre dort zusätzlich flacher.
- **Messgrößen:** SDR (gesamt), SIR (Übersprechen), SAR (Artefakte, „gedämpft/rauschig“), Klangfehler (Spektrum in 48 Bändern 80 Hz–5,5 kHz – das, was der Matcher sieht), Mix ohne Gitarre (fürs Üben), Rechenzeit auf der CPU (Ryzen 7 8845HS, ohne GPU).
- Daten, Skripte und Ergebnisse: `~/stageboard-data/stem-eval/`, nicht im Repo.

### 3.2 Ergebnis (Mittel über 7 Songs)

| Variante | SDR | SIR | SAR | Klangfehler | Zeit / Songlänge |
|---|---|---|---|---|---|
| Demucs `htdemucs_6s` (heute) | 4,96 | 8,14 | 7,63 | 1,47 | 0,2× |
| Demucs, 2 Shifts, 50 % Überlappung | 5,04 | 8,18 | 7,69 | 1,53 | 0,6× |
| becruily Mel-Band-Roformer Gitarre | 5,27 | 7,56 | 8,06 | 1,76 | 1,8× |
| Mittel Demucs + becruily | **5,57** | 7,87 | **8,76** | 1,39 | 2,0× |
| Kaskade: Demucs nimmt Gesang + Bass weg, dann becruily | 5,39 | 7,70 | 8,07 | 1,65 | 1,9× |
| Kaskade mit Kim: Kim-Gesangsmodell nimmt den Gesang weg, dann becruily | 5,45 | 7,77 | 8,31 | 1,77 | ~5,1× |
| **Mittel Demucs + Kim-Kaskade** | **5,69** | 7,98 | **8,92** | 1,40 | ~5,3× |
| Je Frequenz das leisere von beiden („min“) | 5,35 | **9,16** | 7,42 | 1,86 | 2,0× |
| Je Frequenz das lautere („max“) | 4,99 | 6,90 | 8,81 | **1,22** | 2,0× |

dB; höher ist besser außer Klangfehler und Zeit. Vergleich zum Hören: Artifact „Guitar Stem Shootout“ (A/B-Umschalten im Takt, Blindtest).

**Marco nach dem Hören (2026-11-03):** Demucs ist klar am schlechtesten – bei lauten Schlagzeug-Schlägen nimmt es die Gitarre stark zurück. Die anderen drei liegen nah beieinander: Kaskade vor Mittel vor becruily allein. Noch nicht perfekt: etwas Übersprechen, stellenweise flach.

**Zweiter Hörvergleich mit der Kim-Variante (2026-11-03 spät, über das UMC-Interface und Kopfhörer):** alle Varianten klingen sehr gut, keine ist durchgehend vorn. Je nach Song ist mal Demucs besser, mal eine der anderen. Damit relativiert sich das erste Urteil (Demucs klar am schlechtesten): über bessere Abhöre ist der Abstand im Ohr klein, die Messgrößen (§3.2) bleiben der einzige eindeutige Unterschied.

**Erkenntnisse:**

- Der Sprung kommt vom Modell (becruily), nicht von Einstellungen: mehr Shifts bei Demucs bringen +0,08 dB für die dreifache Zeit.
- Übersprechen im becruily-Stem kommt vor allem von Keys (−10,6 dB), dann Gesang (−13,2), Bass (−15,1), Schlagzeug (−19,7).
- Je-Frequenz-Kombinationen verschieben nur Übersprechen gegen Fülle.
- Die Zahlen bevorzugen das Mittel, das Ohr die Kaskade: das Mittel enthält das Wegdrücken der Gitarre durch Demucs zur Hälfte, das die Messgrößen schlecht abbilden. Bei Geschmacksfragen zählt das Ohr.
- Nachtlauf 2026-11-03 (8 Threads, fp32; bfloat16 war 25 % schneller, wich aber hörbar ab, 16 Threads brachten nur 7 %): das Kim-Gesangsmodell (913 MB) vor becruily bringt +0,2 dB gegenüber becruily allein, gemittelt mit Demucs +0,1 dB gegenüber dem bisherigen Mittel – messbar, aber klein, für die 2,5-fache Rechenzeit (4-min-Song ~21 min auf dem Laptop). Im Hörvergleich nicht als besser erkannt (siehe oben) – die 2,5-fache Zeit lohnt sich nach Gehör nicht.
- BS-Roformer SW (700 MB, 6 Spuren): auf 2 Songs uneinheitlich (+0,7 dB auf einem, −1,0 dB auf dem anderen) und über 10× Songlänge – verworfen.

### 3.3 Grenzen, die bleiben

Gitarre gegen Keys/Orgel (gleiche Töne, gleicher Bereich) und der gemeinsame Hall/Bus-Kompressor fertiger Platten. Auch die besten Modelle auf GPUs liegen bei Gitarre um 7–9 dB. „Besser“ geht, „studio-sauber“ nicht.

## 4. Qualitätsstufen beim Trennen (Idee)

Trennen läuft einmal je Song in der Vorbereitung; Zeit ist dort zweitrangig (Marco). Deshalb im Dialog „Spuren trennen“ wählbar:

| Stufe | Inhalt | Zeit für 4 min (CPU) |
|---|---|---|
| Schnell | Demucs wie heute | ~1 min |
| Gut | Mittel Demucs + becruily (oder die Kaskade, die Marco nach Gehör vorn sah) | ~8 min |
| Beste | Mittel Demucs + Kim-Kaskade, als Hintergrund-Job | ~21 min |

Nach dem zweiten Hörvergleich (§3.2) ist „Beste“ nach Gehör nicht von „Gut“ zu unterscheiden; Vorschlag: nur Schnell und Gut anbieten. Weil je Song mal die eine, mal die andere Trennung besser klingt, wäre eine Alternative, beide Stems eines Songs zu behalten und in der Bibliothek je Song umschaltbar zu machen (mehr Speicher, ein Wahlschalter). Beides ist noch nicht entschieden.

Große Modelle als optionale Plugin-Downloads – niemand will 1,5 GB Modelle ungefragt auf dem Server. **Lizenz:** becruily nennt keine Lizenz, das Kim-Modell ist MIT. Intern unproblematisch, vor einem Verkauf klären (docs/16).

## 5. Wie gut muss die Spur für den Matcher sein?

Nicht schätzen, messen: Bei den Test-Songs gibt es die echte Gitarre. Den Matcher einmal gegen die echte Gitarre und einmal gegen jede getrennte Spur laufen lassen und die Presets vergleichen (wie viele dB weichen EQ und Gain ab?). Damit ist „gut genug“ eine Zahl. Zum Einordnen: der Klangfehler heute liegt bei 1,2–1,9 dB, typische Preset-Unterschiede sind EQ-Schritte von 6–12 dB.

Unabhängig davon: nur Stellen verwenden, an denen die Gitarre frei liegt (Intro, Breaks, Solo), und Bänder mit viel Übersprechen schwächer gewichten.

## 6. Reihenfolge

1. Nachtlauf und beide Hörvergleiche ausgewertet (§3.2): keine Variante klar vorn. Offen: Stufen festlegen (nur Schnell/Gut oder beide Stems je Song, §4) (#681).
2. Qualitätsstufen in „Spuren trennen“ (eigenes Issue).
3. Hardware-Annahmen prüfen: USB-Audio und Parameter-Steuerung an MG-30 und Kemper (Emulatoren, dann echt).
4. Matcher offline als Prototyp: Weg B (Regler-Suche) an einem Gerät, Empfindlichkeitstest aus §5.
5. Erst danach Plugin, UI, Wege A und C.

## 7. Offene Fragen

- Welches Gerät zuerst – das, dessen USB-Audio und Steuerung sicher funktionieren (vermutlich MG-30)?
- Wo hängt das Gerät beim Matching – Stage-Server oder Laptop (docs/25)?
- Eigenes Modell feinjustieren (Cambridge-MT hat ~600 Multitracks, viele mit Gitarren; braucht eine Miet-GPU, Lizenz nur Lehre)? Erst, wenn die großen fertigen Modelle ausgereizt sind.
