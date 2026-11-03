# Getrennte Ausgänge: Mehrkanal-Audio auf Tablets (#481, #25)

Stand 2026-11-03, Messungen mit einem Behringer UMC204HD (4 Ausgänge: A = 1/2, B = 3/4, 2 Eingänge, USB Audio Class 2, class compliant). Ziel: Klick nur auf die In-Ears, Track zum FOH – auch auf einem einzelnen Android-Tablet ohne Stage-Server (docs/25), das ist der Kern des Alleinstellungsmerkmals.

## 1. Entscheidungen (Marco)

- Alle Wege zulassen, die echte Kanalzahl samt Grund anzeigen; angeboten werden nur Kanäle, die es gibt.
- **Nie ein falsches Signal ans Publikum:** kein Zusammenmischen auf einen Ausgang als Rückfall. Fällt der Ausgang weg, stoppt nur das Audio dieses Geräts; Show-Uhr, Prompter und Cues laufen weiter, rote Warnung auf allen Geräten, weiter nur über Play.
- Das native Android-Modul hat Vorrang.

## 2. Was welcher Weg kann

| Weg | Kanäle | Abziehen des Interfaces |
|---|---|---|
| Chrome/WebView (auch die Capacitor-App) | 2 (`maxChannelCount`) | Android leitet auf den Lautsprecher um |
| Chrome auf Linux | 2, mit PipeWire-Einstellung `pulse.default.position = [ FL FR RL RR ]` 4 | – |
| Android `AudioTrack` mit Kanal-Index-Maske | 4 diskret, ~78 ms | **leitet nach 67–86 ms auf den Lautsprecher um** – ungeeignet |
| Android AAudio auf fester Geräte-ID | 4 diskret; Redmi ~12,5 ms, Fire ~114 ms | `AAUDIO_ERROR_DISCONNECTED` sofort, nichts aus dem Lautsprecher |
| Eigener USB-Treiber (usbdevfs) | alle, die das Interface hat | `ENODEV` sofort, App läuft weiter |

Normale Apps (Spotify) spielen Stereo; Android kopiert es auf einem 4-Kanal-Interface auch auf 3/4. Nur wer Kanäle einzeln adressiert (Index-Maske, eigener Treiber), bekommt getrennte Signale.

Im geteilten Modus liegt Androids Medienlautstärke für das USB-Gerät im Signalweg (Redmi: Stufe 5/15 = −40 dB). StageBoard muss sie anzeigen und warnen, wenn sie nicht auf 100 % steht.

## 3. Geräte

| Gerät | Android-Treiber | Eigener Treiber |
|---|---|---|
| Fire HD (KFTRPWI, Android 9) | ✅ AAudio 4 Kanäle nach Gehör getrennt | Ausgang ✅, Eingang hängt nach 2 Übertragungen |
| Redmi Pad SE 8.7 (Helio G85/MT8786, Android 16) | ❌ stumm, auch Spotify | Ausgang ✅ nach Gehör, Eingang ⚠️ (§5) |
| Samsung S26, Xiaomi-Handy | ✅ (Spotify) | nicht getestet |

**Redmi, Ursache (logcat, ohne Root):** Der MediaTek-HAL bedient USB selbst (`AudioALSAPlaybackHandlerUsb`). Der erste Schreibvorgang hängt 865 ms, dann „I/O error“, danach bei jedem Versuch „cannot prepare channel: Device or resource busy“ – über 8000-mal in 3 Minuten. Der isochrone Datenstrom kommt nie zustande; die Erkennung (Steuerübertragungen) funktioniert. Fehler werden nicht an die App gemeldet, AAudio zeigt „läuft, keine Aussetzer“. Zusätzlich mischt Xiaomis „MiSound“ USB-Mehrkanal intern auf 2 Kanäle und zurück. Gegenprobe: Audio Evolution Mobile mit eigenem Treiber („eXtream“) spielt auf dem Redmi sauber auf 1/2 und 3/4.

**Hubs:** Der Fire übernimmt am Dell-Dock DA310 die Host-Rolle nur ohne dessen Netzteil – dort also entweder Laden oder USB-Audio. Der Redmi lädt am selben Dock und hostet gleichzeitig. Hub/Dock gehören zur Kompatibilität.

**Lehre:** „Erkannt“ heißt nicht „spielt“. Beim Anschließen braucht es eine Prüfung: Testton mit Rückfrage, später automatisch per Loopback-Kabel (Ausgang in einen Eingang desselben Interfaces).

## 4. Eigener USB-Treiber (Spike)

Code auf Branch `spike/native-audio-481` (`NativeAudioTestPlugin.java`, `src/main/cpp/usb_audio_test.cpp`), keine Fremdbibliothek:

- Java: `UsbManager`-Berechtigung (Dialog je Anstecken), UAC1/UAC2-Deskriptoren parsen (Kanäle, Format, Takt, Endpunkte), Schnittstellen mit `claimInterface(…, true)` von Androids Treiber lösen, Alt-Setting wählen, Abtastrate per `SET_CUR` am Taktgeber setzen.
- C++: isochrone URBs über `USBDEVFS_SUBMITURB`/`REAPURB` auf dem Dateideskriptor der `UsbDeviceConnection`, 8 × 1 ms in der Warteschlange; Paketgröße je 125 µs aus dem Feedback-Endpunkt (asynchroner Modus, 16.16-Format). Thread auf Audio-Priorität (−19).
- Ergebnis Redmi: Ausgang 4 Kanäle nach Gehör getrennt, 0 Paketfehler, Feedback 47 988 Hz wird befolgt, Abziehen sauber erkannt. Rund 500 Zeilen.

## 5. Eingang (offen)

Loopback Main Out L → Eingang 1, Burst alle 500 ms. Manche Sitzungen sind perfekt: 99,9 % der Samples, **Rundlauf 3,0–3,2 ms**, stabil auf ±0,02 ms (gemessen über die Abschlusszeiten der Übertragungen je Richtung; der MediaTek-Controller liefert keine Bus-Framenummer). Andere verlieren von Anfang an 5–20 %: Eingangs-URBs brauchen 1,05–1,25 ms statt 1 ms, ohne Fehlerstatus; größere oder mehr URBs machen es schlimmer. Ausgeschlossen: Thread zu spät, Bildschirm/Energiesparen, Androids Treiber dazwischen, USB-Reset. Nächste Schritte: Aufnahme mit eXtream als Referenz, ein Gerät ohne MediaTek, Reihenfolge der Alt-Settings wie im Linux-Treiber.

## 6. Reihenfolge

1. Eingang stabil, Latenz gemessen (§5).
2. Treiber als echte Ausgabe: Ringpuffer, in den die StageBoard-Audio-Engine (Klick, Track, Stems) schreibt, auf der gemeinsamen Uhr; eine Sitzung je Anstecken, bei Stille läuft der Strom weiter.
3. Geräteprüfung beim Anschließen: entscheidet zwischen AAudio und eigenem Treiber.
4. Sicherer Stopp, rote Warnung, Abziehen; Medienlautstärke anzeigen.
5. UAC1-Geräte (Mischpulte), sobald Testhardware da ist.
6. Danach Server-ALSA (#25) und Einrichtungshinweise für Windows/macOS.
