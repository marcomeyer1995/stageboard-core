# Testplan Synchronität (Referenz-Song, #464)

Stand: 2026-10-09, Entwurf zur Freigabe durch Marco. Grundlage: Referenz-Song (`lib/referenceSong.ts`), Auswertung (`lib/syncAnalysis.ts`, `scripts/analyze-sync-recording.mts`), Messmethode aus docs/13 §6, Gerätelatenzen aus docs/13 §7.

## 1. Warum

Das ganze Konzept steht darauf, dass alle Geräte der Band **im selben Moment dasselbe hören und sehen**: Klick, Backing-Track, Prompter, Blitze, Cues an Effektgeräte und Licht. Bisher gibt es dazu nur Einzelbeobachtungen (Klick holpert, Track sägt auf dem Xiaomi, Klick auf dem S26 gefühlt verschoben). Dieser Plan misst das systematisch, mit bekannter Wahrheit, auf dem echten Bühnenweg, und liefert die Grundlage für die Entscheidungen danach (Ausgleich je Gerät #302, Geräteprofil #303, Nachführung des Tracks, Server-Klick #25).

## 2. Fragen, die der Test beantworten soll

| Nr. | Frage | Szenario |
|---|---|---|
| F1 | Wie weit liegen Klick und Track **auf einem Gerät** auseinander - im Editor, in Solo, im Gig? | S1–S3 |
| F2 | Bleibt das über den ganzen Song gleich (Drift, Sprünge), auch bei Ritardando, Tempowechsel, Taktartwechsel, Pause? | S1–S3, Abschnitte |
| F3 | Wie weit liegen **verschiedene Geräte** auseinander (Klick A gegen Track B, Klick A gegen Klick B)? | S4, S5 |
| F4 | Was passiert bei Pause/Weiter, Stopp/Start, Neuladen eines Geräts, Master-Wechsel mitten im Song? | S6 |
| F5 | Wie robust ist das unter Netzlast (Track-Download läuft, schwaches WLAN)? | S7 |
| F6 | Was passiert, wenn der Bildschirm ausgeht oder die App in den Hintergrund geht? | S8 |
| F7 | Wann kommen Cues (MIDI) und Blitze an, gemessen an der Songzeit? | S9 |
| F8 | Macht #460 (weniger CPU) etwas besser oder schlechter? Browser gegen Android-App? | S10 (Querschnitt) |
| F9 | Hält es über einen langen Abend (30–60 min)? | S11 |
| F10 | Macht der Server einen Unterschied (Laptop gegen Mini-PC)? | S12 |

## 3. Aufbau

### 3.1 Hardware

- **Stage-Server:** zuerst der Laptop (heutiger Produktivserver), später der Dell-Mini-PC als echter Bühnenserver (S12). Router/WLAN wie auf der Bühne.
- **Aufnahme:** Soundcraft **Ui24R per USB am Laptop** (wird als Soundkarte erkannt, alle Eingänge gleichzeitig, eine gemeinsame Uhr). Aufnahme mit `pw-record`/`arecord`, 48 kHz.
- **Geräte:** jedes auf einem eigenen Ui24R-Eingang, Kopfhörerausgang → Line-Eingang (Klinke 3,5 mm → 6,3 mm, unsymmetrisch, Gain niedrig, Pegel am Gerät fest auf z. B. 50 %).

| Ui24R-Kanal | Gerät | Ausgang | Adapter |
|---|---|---|---|
| 1 | Xiaomi-Tablet | Kopfhörer | Klinke 3,5 mm |
| 2 | Xiaomi-Handy | USB-C | USB-C-Klinkenadapter (eigene Latenz - ist der echte Bühnenweg) |
| 3 | Fire HD 10 | Kopfhörer | Klinke 3,5 mm |
| 4 | Samsung S26 | USB-C | USB-C-Klinkenadapter |
| 5 | Laptop/Server (Chrome) | Kopfhörer | optional, als Referenz |
| 6 | (später) Server-Klick über USB-Ausgang des Ui24R (#25) | intern | - |

Jedes Gerät gibt **Klick und Track auf denselben Ausgang** (wie ein Musiker es im Ohr hätte). Wo das Szenario es verlangt, spielt ein Gerät nur den Klick oder nur den Track (Zuordnung über die Logical Devices „Click“ und „Mock Playback“ bzw. die Audio-Ausgabe).

### 3.2 Software

- Referenz-Song in der Band (`scripts/import-reference-song.mts`), Track „Beeps (Messung)“ aktiv.
- Builds: **main** und **#460** (Vorschau). Auf jedem Gerät notieren: Browser oder App, Version (Einstellungen → App), Frontend-Hash (`index-….js`).
- Auswertung: `node scripts/analyze-sync-recording.mts <aufnahme.wav> --track <k> --click <k> --csv <datei>`; für mehrere Kanäle und Paare kommt ein Modus „alle Kanäle“ dazu (siehe §8).

### 3.3 Vor jedem Messblock

1. Alle Geräte am Strom, Bildschirm-Timeout aus (oder lang), Nicht stören an, keine anderen Apps mit Ton.
2. Referenz-Song auf jedem Gerät **vorgeladen** (Einstellungen → Speicher & Sync zeigt den Track als lokal). Sonst misst man den Download mit.
3. App neu laden, **2 Minuten warten** (Uhrabgleich setzt sich, docs/09).
4. Lautstärke am Gerät auf den festen Wert, Ui24R-Gain so, dass die lautesten Pieps bei etwa −12 dBFS liegen (kein Übersteuern - sonst verschiebt sich der Einsatz).
5. Kurzer Probelauf (8 Takte), Pegel und Kanalzuordnung prüfen.

## 4. Szenarien

Jedes Szenario: **3 Läufe**, jeweils der ganze Referenz-Song (2:12). Ein Lauf = eine Aufnahme aller Kanäle. Abschnitte (gleichmäßig, Ritardando, Sprung, Wechsel im Takt, 3/4, Pause, Wiedereinstieg, Schluss) werden einzeln ausgewertet.

### S1 Timeline-Editor (Referenz)
Je Gerät: Song im Editor öffnen, Klick an, abspielen. Erwartung: Klick folgt dem Track (gleiche Uhr), Abstand ≈ Unterschied der Ausgabewege. Dient als Vergleichsmaß für S2/S3.

### S2 Solo/Üben
Je Gerät: Solo, Referenz-Song, Play. Klick und Track auf dem Gerät selbst. (Hier hat Marco auf dem S26 einen Versatz gehört.)

### S3 Gig, Klick und Track auf einem Gerät
Ein Gerät ist Audio-Ausgabe und Klick-Ausgabe, ein anderes Master. Je Gerät einmal als Ausgabe.

### S4 Gig, Klick auf A, Track auf B
Klick-Ausgabe Gerät A, Audio-Ausgabe Gerät B (typisch: Drummer-Klick gegen Backing-Track vom Bühnen-Tablet). Alle sinnvollen Paare, mindestens: Xiaomi↔Fire, Xiaomi↔S26, Fire↔S26.

### S5 Gig, alle Geräte gleichzeitig
Alle Geräte geben den Klick aus (Klick auf „An“ je Gerät), eines zusätzlich den Track. Misst den Abstand der Geräte untereinander - das, was eine Band als „klappert“ hört.

### S6 Störungen mitten im Song
Je ein Lauf, Aufnahme durchgehend:
- a) Pause bei Takt 12, nach 5 s Weiter.
- b) Stopp bei Takt 20, sofort Play (neuer Durchlauf).
- c) Ein Gerät (Audio-Ausgabe) bei Takt 30 neu laden.
- d) Master-Wechsel bei Takt 40 (Pro-Person: Play/Pause auf dem anderen Gerät der Person).
Gemessen: Wie lange bis Klick und Track wieder zusammen sind, Sprünge, ob Cues doppelt kommen.

### S7 Netzlast
- a) Während des Songs lädt ein anderes Gerät einen großen Track (docs/11).
- b) Ein Gerät weit vom Router / hinter einer Wand.

### S8 Bildschirm aus / Hintergrund
Auf dem Gerät mit Klick-Ausgabe bei Takt 16 den Bildschirm ausschalten, bei Takt 32 wieder an. (Bewusste Entscheidung von 2026-09 „Synchron vor Hintergrund-Robustheit“ - der Test zeigt, was passiert, nicht was es soll.)

### S9 Cues und Blitze
- Cues an den Kemper-/MG-30-Emulator auf dem Server (oder echte Geräte, sobald da): Zeitpunkt im Server-Log und im Emulator-Log gegen die Songzeit.
- Blitze (`{alert:}` bei Takt 15 und Takt 55): Video vom Bildschirm mit hörbarem Klick, oder Zeitstempel per Debug-Konsole.
- Später, mit echten Geräten: Ton des Effektgeräts mitschneiden (Patch-Wechsel hörbar).

### S10 Builds und App/Browser (Querschnitt)
S2 und S3 je Gerät mit **main** und mit **#460**, sowie **Browser** und **Android-App**.

### S11 Langer Lauf
Setlist aus 15 × Referenz-Song (oder Referenz-Song + echte Songs), 30–60 min ohne Neustart. Drift, Sprünge, Speicher.

### S12 Server-Varianten
S3 und S5 mit dem Dell-Mini-PC als Server statt des Laptops.

## 5. Bewertung

Vorschlag für Grenzwerte (vor dem Test festgelegt, damit nicht nachträglich passend gemacht wird):

| Größe | gut | noch tragbar | Fehler |
|---|---|---|---|
| Klick minus Track auf einem Gerät, Median | ≤ 10 ms | ≤ 25 ms | > 25 ms |
| Streuung (sd) innerhalb eines Abschnitts | ≤ 5 ms | ≤ 10 ms | > 10 ms |
| Geräte untereinander (Klick A gegen Klick B) | ≤ 20 ms | ≤ 40 ms | > 40 ms |
| Drift | ≤ 2 ms/min | ≤ 5 ms/min | > 5 ms/min |
| Sprünge des Tracks | 0 | 1 je Song | mehr |
| Nach Störung wieder zusammen | ≤ 1 Takt | ≤ 4 Takte | mehr |

Bekannte Ausnahme: der Takt mit dem Tempowechsel **innerhalb** des Takts (Raster richtet nur an Taktanfängen aus) - dort wird der Fehler gemessen und berichtet, aber nicht bewertet.

Hinweis: Musiker nehmen ab etwa 10–20 ms zwischen Klick und Musik einen „Flam“ wahr; über 30 ms klingt es deutlich doppelt. Die Grenzwerte orientieren sich daran.

## 6. Ablauf und Zeitbedarf

| Block | Inhalt | Dauer (ca.) |
|---|---|---|
| 0 | Aufbau, Kanalzuordnung, Pegel, Probelauf | 45 min |
| 1 | S1 + S2 je Gerät, main | 4 Geräte × 2 × 3 Läufe × 2,5 min ≈ 60 min |
| 2 | S3, S4 | 60 min |
| 3 | S5, S6 | 45 min |
| 4 | S10 (#460, App/Browser) | 60 min |
| 5 | S7, S8, S9 | 45 min |
| später | S11, S12 (Dell) | eigener Termin |

Die Auswertung läuft direkt nach jedem Lauf (ca. 10 s je Kanal) - Auffälligkeiten sieht man sofort und kann nachmessen.

## 7. Protokoll

- Dateiname: `JJJJ-MM-TT_<Szenario>_<Build>_<Lauf>.wav`, z. B. `2026-10-12_S2_main_r1.wav`.
- Je Lauf eine Zeile im Protokoll: Uhrzeit, Szenario, Build, je Kanal Gerät + Browser/App + Version + Rolle (Klick/Track/beides), Besonderheiten.
- Ergebnisse: die Tabellen der Auswertung je Lauf, zusammengefasst in docs/13 §8 (neu) mit Diagrammen.

## 8. Vorher noch zu bauen

1. **Auswertung für viele Kanäle:** WAV mit 24/32 Bit und vielen Kanälen lesen; Modus „alle Kanäle“: je Kanal Klick gegen Track (wo beides da ist) und **jedes Paar** Klick-A gegen Track-B sowie Klick-A gegen Klick-B (S5). Die Wahrheit kommt aus dem Track eines Referenzkanals.
2. **Aufnahme-Helfer:** ein Befehl, der die Ui24R-Kanäle aufnimmt und den Lauf benennt.
3. **Störungs-Auswertung (S6):** Zeitpunkte der Aktionen mitschreiben und „bis wieder zusammen“ ausrechnen.
4. Optional: **Testklick-Modus** mit eigener Tonhöhe je Gerät - nur nötig, wenn mehrere Geräte auf *einem* Kanal landen (nicht mit dem Ui24R).

## 9. Offen

- Gerät für Kanal 5/6 und Server-Klick (#25) - erst nach dem ersten Block.
- Dell-Mini-PC: Modell, Ausstattung, Einrichtung (eigener Termin).
- Grenzwerte: zur Freigabe durch Marco.
