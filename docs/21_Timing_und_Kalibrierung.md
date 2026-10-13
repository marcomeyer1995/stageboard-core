# 21 · Timing-Klassen, Latenz und Kalibrierung verteilter Geräte

Stand 2026-10-13 (#491). Konzept, das festlegt, wie StageBoard Geräte unterschiedlicher Wichtigkeit zeitgenau ansteuert, ihre Verzögerung misst und ausgleicht - verankert in der Plugin-Architektur (docs/00 §4/§6). Der Vertrag (§6) ist gebaut; Messung und Kalibrierung (§4/§5) sind Konzept. Bündelt #302 (Audio-Ausgabelatenz), #303 (Geräteprofil) und #317 (Latenz externer Geräte).

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

**Vorlauf-Budget:** Ein Cue kann nur so früh gesendet werden, wie er übergeben wird. Der Vorlauf je Klasse muss größer sein als die größte Latenz plus Streuung in dieser Klasse (heute einheitlich `CUE_LOOKAHEAD_MS` = 100 ms). Ein Gerät mit 300 ms Latenz braucht mehr Vorlauf - der Planer muss den Vorlauf dann je Cue aus der Latenz ableiten. Grenze: Nach Pause/Stop kann ein bereits übergebener Cue nicht immer zurückgeholt werden (`MIDIOutput.clear()` fehlt in Chrome, #477).

**Speicherort (offen):** Das Profil hängt am Ausgabeweg, also an der Kombination Gerät + logisches Gerät (wie `DeviceTransportConfig`). Ausgänge, die der Stage-Server selbst bedient, brauchen denselben Platz mit `deviceId` = Server. Wird mit der Kalibrierung entschieden.

**Abgrenzung zur Uhr-Synchronisation:** Der Uhr-Versatz zwischen Gerät und Server (docs/09) bleibt die Grundlage. Das Latenzprofil beschreibt nur, was **nach** dem Senden im Ausgabeweg passiert.

## 4. Kalibrierung

### Prinzip

1. Der Kern wählt einen kalibrierbaren Ausgang (Plugin-Angabe `calibration`) und einen passenden Sensor.
2. Er löst den **Reiz** (`stimulus`, z. B. Licht voll an) N-mal zu bekannten, im Voraus geplanten Zeitpunkten Tᵢ aus (wie ein Cue, mit `scheduledAt`), danach jeweils `reset` (Licht aus).
3. Der Sensor meldet jede Erkennung mit Zeitstempel in Server-Zeit Dᵢ.
4. Latenz = Median(Dᵢ - Tᵢ) - Eigenlatenz des Sensors; Streuung aus der Verteilung. Ausreißer (verpasste Erkennungen) werden verworfen; zu wenige gültige Messungen = Fehlschlag mit Grund.
5. Ergebnis als `LatencyProfile` mit `source: 'measured'` speichern.

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
2. Tablet-Messung #477 (`clear()`, Zeitstempel-Genauigkeit im Android-WebView) → Vorlauf je Klasse festlegen.
3. Speicherort und Anzeige der Latenzprofile (Geräte-Tab, #303), manuelle Eingabe (`source: 'manual'`).
4. Sensor-Schnittstelle (`timing-sensor`) und ein erster Sensor (Hardware-Entscheidung).
5. Kalibrierlauf und Soundcheck-Prüfung (§4/§5), zuerst für Licht und Audio-Ausgänge (#302).
6. Ein echtes DMX-Plugin mit deklarierter Interface-Latenz und Kalibrier-Reiz.

## Verwandt

docs/00 §4/§6 (Präzisions-Engine, Plugins), docs/09 (Uhr-Synchronisation), docs/13 §7 (gemessene Ausgabelatenz), docs/19 (Track auf der Audio-Uhr), docs/20 (Wettbewerb: niemand kalibriert verteilte Geräte), #302, #303, #317, #477, #478.
