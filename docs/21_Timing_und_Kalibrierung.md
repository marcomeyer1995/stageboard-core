# 21 · Timing-Klassen, Latenz und Kalibrierung verteilter Geräte

Stand 2026-10-13 (#491), mit ersten Messungen (§8). Konzept, das festlegt, wie StageBoard Geräte unterschiedlicher Wichtigkeit zeitgenau ansteuert, ihre Verzögerung misst und ausgleicht - verankert in der Plugin-Architektur (docs/00 §4/§6). Der Vertrag (§6) ist gebaut; Messung und Kalibrierung (§4/§5) sind Konzept. Bündelt #302 (Audio-Ausgabelatenz), #303 (Geräteprofil) und #317 (Latenz externer Geräte).

## 1. Warum

StageBoard verteilt die Show: jedes Gerät führt zur gemeinsamen Song-Zeit seinen Teil aus (docs/00 §4). Die Uhr-Synchronisation (docs/09) sorgt dafür, dass alle Geräte **dieselbe Zeit** kennen; seit #477 gehen MIDI-Cues **auf die Millisekunde** zu dieser Zeit raus. Was danach passiert, weiß StageBoard nicht:

- Eine DMX-Lampe braucht nach dem Befehl noch Zeit, bis sie leuchtet (Interface-Takt, Dimmerkurve, LED-Treiber).
- Ein Audio-Ausgang spielt um seine Ausgabelatenz später (gemessen 24 ms bis 400 ms je Gerät, docs/13 §7).
- Ein Mischpult verarbeitet einen Fader-Befehl mit eigener Verzögerung, eine Kamera zeichnet versetzt auf.

Für manche Geräte ist das egal, für andere entscheidend: Licht, das 40 ms nach dem Schlag kommt, sieht jeder; ein In-Ear-Fader, der 40 ms später greift, merkt niemand. Deshalb braucht es **Klassen** (wie genau muss es sein), ein **Latenzmodell** (wie spät ist es) und eine **Kalibrierung** (gemessen statt geschätzt) - und alles drei muss ein Plugin beschreiben können, nicht der Kern für jedes Gerät einzeln.

## 2. Timing-Klassen

Jede Fähigkeit (Capability) gehört zu genau einer Klasse. **Das Plugin legt sie fest**, die Band ändert sie nicht (Entscheidung Marco, 2026-10-13).

| Klasse | Beispiele | Toleranz | Was der Kern tut |
|---|---|---|---|
| `sample` | Klick, Backing-Track, MIDI Clock (#478) | ≤ 2 ms | probengenau auf der Audio-Uhr planen, Ausgabelatenz ausgleichen |
| `realtime` | DMX-Licht, Video, Effektwechsel auf dem Schlag (Kemper, MG-30, RC-500) | ≤ 10 ms | mit Zeitstempel bzw. `scheduledAt` senden, Latenz ausgleichen, Kalibrierung empfohlen |
| `soft` | In-Ear-Mischpult (CQ-18T, Ui24R), Mischpult-Szenen | ≤ 100 ms | geplant senden, keine Kalibrierung nötig |
| `none` | Presets vor dem Song, Status, Setlist-Anzeige | - | sobald möglich |

Die Toleranz (`TIMING_CLASS_TOLERANCE_MS`) ist der Maßstab für die Prüfung beim Soundcheck (§5), den Nachbericht und den Sync-Check.

## 3. Latenzmodell und Ausgleich

Für jeden **Ausgabeweg** (eine logische Ressource, angesteuert von einem bestimmten Gerät über einen bestimmten Transport - z. B. „Frontlicht über das USB-DMX-Interface am Stage-Server“, „Klick über den Kopfhörer des Xiaomi“) gibt es ein Latenzprofil (`LatencyProfile`):

- `latencyMs` - Zeit vom Senden bis zur echten Ausgabe,
- `jitterMs` - Streuung,
- `source` - woher der Wert stammt: `plugin-default` (vom Plugin angegeben), `measured` (kalibriert), `manual` (von Hand eingetragen),
- Messzeitpunkt, Sensor, Anzahl Messungen.

**Ausgleich = früher senden:** Der Cue-Planer (#477) sendet jeden Cue um die Latenz seines Ausgangs früher (`sendAt = dueAt - latencyMs`, `cueLatencyMs`). Bei Audio verschiebt der Motor den Startzeitpunkt auf der Audio-Uhr (#302). Gebaut ist der Ausgleich mit dem Plugin-Wert; kalibrierte Werte ersetzen ihn, sobald §4 gebaut ist.

**Vorlauf-Budget:** Ein Cue kann nur so früh gesendet werden, wie er übergeben wird. Der Vorlauf je Klasse muss größer sein als die größte Latenz plus Streuung in dieser Klasse (heute einheitlich `CUE_LOOKAHEAD_MS` = 200 ms, §8.2). Ein Gerät mit 300 ms Latenz braucht mehr Vorlauf - der Planer muss den Vorlauf dann je Cue aus der Latenz ableiten. Grenze: Nach Pause/Stop kann ein bereits übergebener Cue nicht zurückgeholt werden (`MIDIOutput.clear()` gibt es auf keinem unserer Geräte, #477).

**Speicherort (gebaut, 2026-10-13):** eigene synchronisierte Sammlung `latency-profile`, ein Dokument je Ausgabeweg mit Id `Gerät:Ausgang:Weg` (`LatencyProfileDoc`): `deviceId` ist das Gerät, das den Ausgang bedient (für Stage-Server-Ausgänge `server`), `output` ein logisches Gerät oder `audio` für den eigenen Ton (Klick, Track), `route` der Audio-Ausgabeweg. Der Weg wird in der nativen App erkannt (`AudioRoutePlugin`: Lautsprecher, Kabel, Bluetooth, USB; Entscheidung Marco: je erkanntem Weg), im Browser `unbekannt`.

**Anwendung (gebaut):**
- Cues: gespeicherter Wert des ausführenden Geräts vor dem Plugin-Wert (`cueLatencyMs`).
- Klick: jeder Schlag um die Latenz früher geplant, das Vorausfenster um sie erweitert; ein Schlag, dessen früher Zeitpunkt schon vorbei ist (Latenz länger als der Play-Vorlauf, Fire 430 > 400 ms), klingt sofort statt zu entfallen.
- Backing-Track (`<audio>` und Web Audio): läuft um die Latenz der Song-Zeit voraus.
- Automatisch, sobald ein Wert existiert; je Gerät abschaltbar (Einstellungen → „Ton-Latenz ausgleichen“, Entscheidung Marco).
- Eintragen von Hand im Tab Geräte (`Latenz…` je Gerät und beim Stage-Server); die Zeile je Gerät zeigt die Werte mit Quelle.

**Abgrenzung zur Uhr-Synchronisation:** Der Uhr-Versatz zwischen Gerät und Server (docs/09) bleibt die Grundlage. Das Latenzprofil beschreibt nur, was **nach** dem Senden im Ausgabeweg passiert.

## 4. Kalibrierung

### Prinzip

1. Der Kern wählt einen kalibrierbaren Ausgang (Plugin-Angabe `calibration`) und einen passenden Sensor.
2. Er löst den **Reiz** (`stimulus`, z. B. Licht voll an) N-mal zu bekannten, im Voraus geplanten Zeitpunkten Tᵢ aus (wie ein Cue, mit `scheduledAt`), danach jeweils `reset` (Licht aus).
3. Der Sensor meldet jede Erkennung mit Zeitstempel in Server-Zeit Dᵢ.
4. Latenz = Median(Dᵢ - Tᵢ) - Eigenlatenz des Sensors; Streuung aus der Verteilung. Ausreißer (verpasste Erkennungen) werden verworfen; zu wenige gültige Messungen = Fehlschlag mit Grund.
5. Ergebnis als `LatencyProfile` mit `source: 'measured'` speichern.

### Unregelmäßige Reize - kein Verwechseln der Sekunden (gebaut, 2026-10-13)

Ein Reiz pro Sekunde macht die Latenz nur **bis auf ganze Sekunden** bestimmbar: Ein Klick, der 1,2 s zu spät kommt, landet neben dem *nächsten* Sollzeitpunkt und sieht wie 0,2 s aus (Hinweis Marco, 2026-10-13; schon die Fire-Latenz von 433 ms lag nahe an der Grenze von 500 ms, Bluetooth darüber). Deshalb:

- Der Stage-Server plant die Reize mit **lauter verschiedenen Abständen** (700-1500 ms, gemischt, `irregularSchedule`).
- Ausgewertet wird das **ganze Muster**: für jede mögliche Verzögerung von −50 ms bis 2 s zählt der Server, wie viele geplante Reize einen erkannten Einsatz im Abstand ≤ 15 ms haben, und nimmt die Verzögerung mit den meisten Treffern (`matchLatency`). Nur bei der richtigen passt die ganze Folge.
- **Eindeutig** heißt: mindestens 60 % der Reize erkannt, und keine andere Verzögerung (> 50 ms entfernt) erklärt mehr als die Hälfte davon. Bei einem regelmäßigen Muster schlägt genau diese Prüfung an (Test).

### Gebaut: Mikrofon des Stage-Servers als erster Sensor

- `POST /calibration/runs` → unregelmäßige Klickzeiten (Server-Zeit), Aufnahme läuft bis 2 s nach dem letzten; `GET /calibration/runs/:id` → Ergebnis (Latenz, Streuung, Treffer, eindeutig). Eine Messung zur Zeit.
- Aufnahme mit `arecord` (Gerät `CALIBRATION_AUDIO_DEVICE`, Standard `default`), Einsatzerkennung wie in `sync-receiver.py`, Zeitbezug über den am wenigsten gepufferten Block - übrig bleibt ein konstanter Aufnahmeversatz von wenigen ms, für alle Geräte gleich.
- Im Gerät: Geräte-Tab → „Latenz…“ beim eigenen Gerät → **Messen** (rohe Latenz des aktuellen Ausgabewegs, „Übernehmen“ speichert als `gemessen`) und **Prüfen** (mit gespeichertem Wert; passt, wenn der Klick ≤ 15 ms neben dem Schlag landet - die Kurzprüfung zum Soundcheck).

### Sensoren - Hardware bewusst offen

Ein Sensor ist selbst ein Plugin mit einer eigenen Fähigkeit (Vorschlag: `timing-sensor`) und meldet Erkennungen als Ereignisse mit Server-Zeitstempel. Welche Hardware, ist offen (Entscheidung 2026-10-13); die Schnittstelle trägt alle:

| Sensor | Erkennt (`SensorKind`) | Vorteile | Nachteile |
|---|---|---|---|
| Fotodiode / Mikrofon am **Audio-Eingang des Stage-Servers** (USB-Interface, Line-In) | `light`, `sound` | probengenau (~0,02 ms), billig, ein Eingang für alles | Kabel zum Server, Pegel anpassen |
| **Mikrocontroller-Box** (ESP32/Arduino mit Fotodiode und Mikrofon) | `light`, `sound` | flexibel, drahtlos möglich, Produktidee für die Box | eigene Hardware, eigene Uhr muss synchronisiert werden |
| **Tablet/Handy** (Mikrofon, Kamera, Lichtsensor) | `sound`, `video`, grob `light` | keine Zusatzhardware | grob (Kamera 30-60 fps), eigene Eingangslatenz |
| **MIDI-Rückweg** (MIDI-Thru zurück an einen Eingang) | `midi-loopback` | exakt für den MIDI-Weg | misst nur die Leitung, nicht das Gerät |

Die **Eigenlatenz des Sensors** wird einmal gegen eine bekannte Referenz bestimmt (z. B. ein Klick, der probengenau über denselben Audio-Ausgang ausgegeben wird, an dem auch der Sensor hängt).

### Beispiele je Gerätetyp

- **DMX-Licht:** Reiz „voll an“, Fotodiode vor der Lampe → Interface-Takt + Dimmer + LED. Klasse `realtime`, der wichtigste Fall.
- **Audio-Ausgang eines Tablets (#302):** Reiz Klick, Mikrofon → Ausgabelatenz je Route (Lautsprecher, Kopfhörer, Bluetooth, USB-Interface).
- **Amp-Modeller (Kemper):** Reiz Rig-Wechsel auf einen lauten/leisen Patch, Mikrofon oder Line-Out am Audio-Eingang → Umschaltzeit. Optional, Klasse `realtime`.
- **Mischpult (IEM):** Klasse `soft` - keine Kalibrierung nötig. Höchstens eine Prüfung über die Rückmeldung des Pults (Meter/Statusecho).
- **Video/Beamer, Kamera:** Reiz Weißbild auf dem Beamer → Fotodiode; Kamera: Server löst eine LED aus, die Kamera filmt sie, der Versatz im Bild ergibt die Aufnahmelatenz.

## 5. Wann: einmal je Aufbau, Kurzprüfung beim Soundcheck

Entscheidung 2026-10-13:

- **Kalibrieren** einmal je Aufbau - neu, wenn sich Gerät, Interface oder Weg ändert (anderes Tablet, Bluetooth statt Kabel). Gespeichert je Ausgabeweg.
- **Prüfen** vor jeder Show (Soundcheck): ein kurzer Lauf mit wenigen Reizen, der die gespeicherten Werte nur **vergleicht**. Weicht ein Weg mehr als die Toleranz seiner Klasse ab, gibt es eine Warnung mit „neu kalibrieren?“. Anzeige im Sync-Check-Widget bzw. im Geräte-Tab (#303).
- **Während der Show** keine Messung; der Nachbericht zeigt, wo ein Gerät eine Ausführungszeit zurückmeldet, wie spät ein Cue tatsächlich war.

## 6. Verankerung im Plugin-Vertrag (gebaut, 2026-10-13)

`shared-types/src/timing.ts`, Feld `timing` im Plugin-Manifest (`PluginInstallation`):

```ts
timing: [{
  capability: 'lighting',
  timingClass: 'realtime',          // sample | realtime | soft | none
  honoursScheduledAt: false,         // Translator sendet selbst zum Zeitpunkt (WebMIDI-Zeitstempel)?
  defaultLatencyMs: 25,              // bekannte Latenz vor jeder Kalibrierung
  calibration: {                     // optional: wie kalibrierbar
    stimulus: { type: 'calibration.flash' },
    reset: { type: 'calibration.dark' },
    detectableBy: ['light'],
  },
}]
```

- Ein Plugin deklariert **je Fähigkeit mit Ausgabe** einen Eintrag; ohne Eintrag gilt `none`, Ausführung bei Empfang.
- `honoursScheduledAt` ersetzt die fest verdrahtete Liste aus #477: Der Kern (`cueFiring.ts`) gibt `scheduledAt` nur an Translatoren weiter, die es selbst einhalten; alle anderen ruft er erst zum Zeitpunkt auf. Server-Plugins brauchen das Flag nicht - das Gateway hält jedes Ereignis bis `scheduledAt`.
- Klick und Backing-Track brauchen auf dem Tablet kein Plugin; der Kern deklariert sie selbst als `sample` (`capabilityTiming.ts`).
- Manifeste, die vor diesem Feld installiert wurden, haben keinen `timing`-Eintrag; der Kern nimmt dann den Katalog-Eintrag mit derselben Plugin-Id.
- Kalibrierte Werte (`LatencyProfile`) gehören nicht ins Manifest, sondern zum Ausgabeweg (§3).

Die Katalog-Einträge (`pluginCatalog.ts`) deklarieren heute: Kemper, MG-30, RC-500 `realtime` mit Zeitstempel; CQ-18T `soft` mit Zeitstempel; Ui24R und Mock-Mixer `soft`; Mock-Licht `realtime` mit Kalibrier-Reiz; Mock-Playback/-Klick `sample`.

## 7. Reihenfolge

1. ~~Vertrag im Plugin-Manifest, Ausgleich mit Plugin-Latenz im Cue-Planer~~ (gebaut, 2026-10-13).
2. ~~Tablet-Messung #477 → Vorlauf~~ (erledigt: 200 ms für alle, §8.2 - größere Latenzen gehen automatisch, weil der Vorlauf ab dem früheren Sendezeitpunkt zählt).
3. ~~Speicherort und Anzeige der Latenzprofile (Geräte-Tab, #303), manuelle Eingabe, Ausgleich für Cues, Klick und Track (#302)~~ (gebaut, 2026-10-13).
4. ~~Erster Sensor: Mikrofon des Stage-Servers~~ (gebaut, 2026-10-13); allgemeine Sensor-Schnittstelle (`timing-sensor`) für weitere Sensoren offen.
5. ~~Kalibrierlauf und Prüfung für Audio-Ausgänge (#302)~~ (gebaut, 2026-10-13: Messen/Prüfen); für Licht offen (braucht Lichtsensor und Licht-Plugin).
6. Ein echtes DMX-Plugin mit deklarierter Interface-Latenz und Kalibrier-Reiz.

## 8. Messungen 2026-10-13

Erste Messreihe zu allen Wegen, die heute ohne Zusatzhardware messbar sind. Rohdaten und Tabellen in den Kommentaren zu #477 und #491, Skripte in `scripts/midi-timing-probe/` (README). Geräte: Laptop (Stage-Server, Chrome 154), Xiaomi Redmi Pad SE (Android 16, WebView 153), Xiaomi 14T Pro (WebView 153), Fire HD 10 (Android 9, WebView/Silk 138).

**Methode:** Die Tablets stehen im USB-Modus „MIDI“ am Laptop, der Laptop sieht sie als MIDI-Geräte. Weil der Laptop der Stage-Server ist, ist seine Uhr die Server-Zeit - jede Ankunft lässt sich direkt gegen den Sollzeitpunkt messen (`time.time_ns()`, USB-MIDI-Weg ~1 ms). Ton über das Laptop-Mikrofon (ein Gerät zur Zeit, Klick-Cluster gegen Raumgeräusche getrennt; absolute Werte enthalten einige ms Aufnahmeversatz des Laptops, für alle Geräte gleich).

### 8.1 Senden mit WebMIDI-Zeitstempel (#477)

- Mit Zeitstempel geplante Nachrichten kommen auf allen Geräten auf ~0,3 ms genau an (Median), schlimmstenfalls ~5 ms - **unabhängig von der Last**, auch mit allen Kernen ausgelastet.
- `MIDIOutput.clear()` gibt es auf keinem Gerät (Chrome 154, WebView 153 und 138): Übergebene Cues lassen sich nicht zurückholen.
- Chrome hält die Reihenfolge von Nachrichten mit gleichem Zeitstempel nicht ein → je weitere Nachricht eines Ereignisses 0,1 ms später (`SEQUENCE_STEP_MS`).
- Was Cues verspätet, sind **Stillstände des Hauptthreads**, nicht die CPU-Last: Mit 100 ms Vorlauf kamen bei 150-ms-Stillständen 3-7 von 48 Noten bis 54 ms zu spät, mit 150 ms keine (Xiaomi und Fire gleich). Der alte Weg (Senden „jetzt“) lag dabei bis 125 ms daneben.

### 8.2 Stillstände in der echten App

Diagnose-Tab „Cue-Timing auf diesem Gerät“ (#493) bzw. Long-Task-Beobachter, Gig-Läufe in der Test-Band:

| Gerät / Rolle | Stillstände ≥ 50 ms | längster |
|---|---|---|
| Fire, Master + Prompter | 5-9 in ~1,5 min | 84-93 ms |
| Xiaomi-Tablet, Audio-Gerät (Track + Klick) | 9 in ~1,5 min | 76 ms |
| Fire, Audio-Gerät (Web-Audio-Track + Klick) | 8 in ~1,5 min / 8 in ~1 min mit schnellem Weiterschalten | 92 / 87 ms |

Die kritische Grenze bei 100 ms Vorlauf ist 75 ms (Vorlauf minus ein Takt) - sie wurde in jedem Lauf einige Male überschritten. **Entscheidung (Marco, 2026-10-13): `CUE_LOOKAHEAD_MS` = 200 ms**, Grenze 175 ms - fast doppelt so viel wie der längste gemessene Stillstand (93 ms). Preis: Ein Cue in den letzten 200 ms vor Pause/Stop geht noch raus. Der Diagnose-Tab misst bei jeder Probe weiter.

### 8.3 Synchronität zwischen Geräten

Diagnose-Tab „Synchron-Test“ (#494) auf mehreren Geräten gleichzeitig, jede volle Server-Sekunde eine MIDI-Note:

| Gerät | Versatz zur Server-Zeit (Median, zwei Läufe) | Streuung im Lauf |
|---|---|---|
| Fire HD 10 | +0,1 / +1,0 ms | ±1-2 ms |
| Xiaomi Redmi Pad SE | +5,7 / +2,9 ms | ±1-2 ms |
| Xiaomi 14T Pro | +7,9 ms | ±1 ms |

- Alle Geräte treffen dieselbe Server-Sekunde innerhalb ~8 ms, das größte Paar liegt ~7 ms auseinander - knapp innerhalb `realtime` (≤ 10 ms).
- Der Versatz je Gerät ist innerhalb einer Sitzung konstant, wandert aber zwischen Sitzungen um einige ms (Schätzung der Uhr-Synchronisation, docs/09). Das ist korrigierbar (erneute Synchronisation, Kalibrierung), kein Zittern.

### 8.4 Ausgabelatenz des Klicks (#302)

| Gerät (Lautsprecher) | MIDI derselben Sekunde | Klick im Mikrofon | Tonweg hinter MIDI |
|---|---|---|---|
| Xiaomi Redmi Pad SE | +3,7 ms | +72,7 ms (sd 1,4) | ~69 ms |
| Xiaomi 14T Pro | +1,3 ms | +67,9 ms (sd 3,8) | ~67 ms |
| Fire HD 10 | +3,5 ms | +433 ms (sd 5,0) | ~430 ms |

- Je Gerät stabil (sd 1-5 ms), also eine Konstante je Ausgabeweg - genau das, was der Ausgleich (§3) braucht.
- Zwischen Geräten riesig: Der Klick des Fire kommt ~360 ms nach dem der Xiaomis. Ohne Ausgleich ist der Fire als Audio-Gerät zusammen mit anderen Audio-Geräten unbrauchbar.
- Der vom Browser gemeldete Wert stimmt nicht (docs/13 §7: 40 ms beim Xiaomi-Tablet).
- Der Synchron-Test misst das in einer Minute je Gerät - Vorlage für den Kalibrierlauf (§4, Sensor `sound`).

### 8.5 Fallstricke

- MIUI setzt den USB-Modus „MIDI“ von selbst zurück (Bildschirmsperre); die App zeigt dann einen veralteten Ausgang, Noten gehen ins Leere → Modus neu setzen, Diagnose-Tab neu öffnen.
- Lautstärke per adb: `cmd media_session volume --set` meldet Erfolg, ändert auf den Xiaomis aber nichts - Tablet: Lautstärketasten (`input keyevent`), Handy: `cmd audio set-volume 3 N`, Fire: `media volume --stream 3 --set N`.
- Release-Apps sind nicht inspizierbar: Messwerte deshalb im Diagnose-Tab anzeigen und per `adb exec-out screencap` ablesen; Silk lehnt das Zertifikat des Stage-Servers ab.

### 8.6 Automatische Kalibrierung („Messen“/„Prüfen“, #498)

Mikrofon des Stage-Servers, 12 Klicks in unregelmäßigem Abstand, Geräte neben dem Laptop:

| Gerät | Messen | Prüfen mit gespeichertem Wert |
|---|---|---|
| Xiaomi Redmi Pad SE | **73 ms** (12/12 Klicks, Streuung 1 ms) - wie von Hand gemessen (72,7) | **0 ms** |
| Fire HD 10 | 408 / 436 / 444 ms (je 8-12/12 Klicks) | +41 / +31 / +29 ms (mit 408), −17 ms (mit 444) |

- Das Verfahren rechnet richtig: „Prüfen“ weicht genau um den Unterschied zwischen gespeichertem und aktuellem Wert ab.
- **Der Fire schwankt selbst** um etwa ±18 ms zwischen Messungen (408-444 ms); genauer als das lässt er sich nicht ausgleichen. Die Xiaomis sind stabil. Idee: „Messen“ mehrfach laufen lassen und den Median speichern.
- Fallstrick: PipeWires `default`-Quelle nahm den Klick eines Tablets nicht wahr (0 Einsätze), das Hardware-Gerät schon (30 dB Aufnahmeverstärkung) → `CALIBRATION_AUDIO_DEVICE=plughw:CARD=Generic_1,DEV=0` in der systemd-Unit des Stage-Servers (per Name, weil USB-MIDI-Geräte die Kartennummern verschieben).

### 8.7 Noch offen

Windows-Laptop (nur Klick), Kopfhörer-/Bluetooth-/USB-Interface-Wege, Eigenversatz des Laptop-Mikrofons, echte MIDI-Geräte am USB-Host-Kabel, Licht mit Fotodiode.

## Verwandt

docs/00 §4/§6 (Präzisions-Engine, Plugins), docs/09 (Uhr-Synchronisation), docs/13 §7 (gemessene Ausgabelatenz), docs/19 (Track auf der Audio-Uhr), docs/20 (Wettbewerb: niemand kalibriert verteilte Geräte), #302, #303, #317, #477, #478.
