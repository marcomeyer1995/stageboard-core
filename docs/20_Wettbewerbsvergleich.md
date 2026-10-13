# 20 · Wettbewerbsvergleich: BandHelper, Ableton-Rig, Prime

Stand 2026-10-13. Ausführlicher Vergleich der drei wichtigsten Alternativen, mit denen Bands heute das lösen, was StageBoard lösen will. Grundlage: Herstellerseiten und -anleitungen (Quellen am Ende), nicht selbst ausprobiert. Preise ohne Gewähr. Die Folgerungen für Positionierung und Vermarktung stehen in docs/16 §1a.

## 1. Kurzfassung

Alle drei Konkurrenten lösen das Timing-Problem auf dieselbe Art: **Alles Zeitkritische läuft auf einem einzigen Abspielgerät.** Dieses Gerät spielt Tracks und Klick und sendet alle MIDI- und OSC-Befehle von seiner eigenen Uhr. Die anderen Geräte der Band zeigen nur an (Texte, Akkorde, Setlist); dort spielt eine halbe Sekunde Verzögerung keine Rolle.

Das ist einfach und präzise, solange das eine Gerät läuft und alle Hardware per Kabel oder Netz an ihm hängt. Die Grenzen:

- Das Abspielgerät ist ein **Single Point of Failure**. Nur Ableton mit AbleSet und einem zweiten Rechner (plus redundantem Audio-Interface) löst das, mit erheblichem Aufwand.
- **Hardware weit weg vom Abspielgerät** (Gitarren-Amp auf der anderen Bühnenseite) braucht ein MIDI-Kabel quer über die Bühne oder Netzwerk-MIDI.
- **Zeit auf einem zweiten Gerät** (eigener Track im eigenen Ohr, Cue vom eigenen Tablet) ist nicht synchron. BandHelper sagt das ausdrücklich.

StageBoard verteilt die Zeit statt sie zu bündeln: eine Server-Uhr auf jedem Gerät, Play 400 ms im Voraus geplant (docs/19), jedes Gerät steuert seine eigene Hardware. Das ist der eigentliche Unterschied - alles andere (Setlists, Texte, Klick, Tracks, MIDI beim Songwechsel) können die Konkurrenten auch, meist ausgereifter.

## 2. Die drei Konkurrenten im Überblick

| | BandHelper | Ableton-Rig (Live + AbleSet) | Prime (Loop Community) |
|---|---|---|---|
| **Zielgruppe** | Alle Bands, von Hobby bis Profi; Schwerpunkt Organisation + Bühne | Profi-Bands und Tour-Produktionen mit Playback-Techniker oder MD | Kirchen- und Worship-Teams |
| **Kern** | Repertoire, Setlists, Texte/Akkorde, Band-Verwaltung | Multitrack-Playback in einer DAW, AbleSet als Setlist- und Bühnen-Oberfläche | Multitrack-Playback mit Katalog, Klick und Ansagen |
| **Plattform** | iOS, Android, Mac, Windows, Web, Apple Watch | Mac oder Windows (Rechner); Tablets/Handys nur als Browser-Oberfläche | Nur iOS, iPadOS, macOS |
| **Wo läuft die Zeit** | Auf dem Gerät, das Tracks/Klick spielt | Auf dem Ableton-Rechner (Arrangement-Zeitleiste) | Auf dem einen Prime-Gerät |
| **Andere Geräte** | Live Sharing: Bildschirm spiegeln (1-3 s) oder Aktionen folgen (~0,5 s) | Browser-Oberfläche je Gerät (Text, Abschnitte, Steuerung), Zustand vom Rechner | Mitglieder sehen geteilte Setlists; Akkorde/Texte über WorshipTools Charts/Presenter |
| **Ausfallsicherheit** | Keine (Leitgerät fällt aus → Show steht) | AbleNet: 2+ Rechner parallel, Drift-Korrektur, redundantes Interface schaltet um | Keine |
| **Preis** | Band 2-5 Leute: 40-80 $/Jahr | Live Standard ca. 279 € + AbleSet 129-269 $ einmalig + Rechner + Interface; mit Redundanz zweiter Rechner + Umschalt-Interface | App gratis (Basic); Standard/Plus als Abo (Preise nicht öffentlich auf der Seite); Tracks aus dem Katalog extra |

## 3. BandHelper

**Was es ist:** Die umfassendste Band-App am Markt. Seit über zehn Jahren, alle Plattformen, ein Abo für die ganze Band.

**Funktionen, die StageBoard auch hat:** Songs mit ChordPro, Transponieren (auch persönlich je Mitglied), Setlists mit Pausen und Dauer, Backing-Tracks, Klick mit Betonung und Unterteilung, Stimmgerät, Fußschalter per MIDI/Bluetooth, MIDI beim Songwechsel, frei gestaltbare Bildschirm-Layouts (mehrere je Gerät), Offline-Kopie aller Daten, Loop/Tempo/Tonhöhe zum Üben, Aufzeichnung von Aktionen (≈ unser Cue-Recorder).

**Funktionen, die StageBoard nicht hat:** Kalender mit Verfügbarkeitsabfrage, Kontakte, Finanzen und Rechnungen, Bühnenpläne, Checklisten, Übe-Protokoll; PDF/Noten mit Anmerkungen, Video; MIDI-Dateien abspielen; OSC; MIDI Beat Clock; getrennte Ausgänge für Klick und Tracks über ein Interface (nur iOS/macOS); bis zu 8 Tracks gleichzeitig (nur iOS/macOS); Apple Watch.

**MIDI und OSC im Detail:**
- **Presets am Song:** Programmwechsel (mit Bank), Controller, Roh-MIDI (Hex), Song Select; OSC mit Adresse und höchstens einem Argument. Gerät = Name, Kanal, Port. Gesendet beim Songwechsel, per Knopf im Layout oder als Aktion; Presets lassen sich verketten, paaren (an/aus) und für alle Songs „anpinnen“.
- **Automationsspuren:** live aufgenommene Aktionen je Song (Preset senden, Aufnahme starten, Tempo an/aus, scrollen, Zeile hervorheben). Zeitbasis **Sekunden ab Start**, auf 0,01 s editierbar, **nicht an Takte gebunden**. Ein Sprung nach vorn holt übersprungene Ereignisse nicht nach.
- **MIDI-Datei synchron zur Aufnahme** (nur iOS/macOS, neue Audio-Engine): Daten laufen mit dem Audio, auch bei Pause, Spulen, Tempoänderung. Der präziseste Weg, weil Gerät und Uhr dieselben sind.
- **Beat Clock** vom Gerät mit laufendem Tempo; Android ab Version 6.
- Verbindungen: USB, Bluetooth LE, RTP-MIDI; OSC über WLAN.

**Mehrere Geräte (Live Sharing):** Ein Leitgerät sendet. „Bildschirm teilen“ spiegelt (1-3 s, Folgegeräte können nichts selbst). „Aktionen teilen“: jedes Gerät behält Layout und Funktionen und folgt den Aktionen des Leiters, vor allem der Songwahl (~0,5 s, Ausgleich per „Delay Actions“). Ohne Internet: nur-iOS über Bluetooth/WLAN direkt, gemischt oder Android über einen einfachen Router. BandHelper selbst: **nicht für präzises Timing** wie synchrone Metronome oder geschichtete Audiospuren.

**Stärker als StageBoard:** Breite, Plattformen, Reife, Preis, Band-Verwaltung, kein Server nötig.
**Schwächer als StageBoard:** Keine gemeinsame Uhr; Leitgerät ist Single Point of Failure; Hardware nur als Port/Kanal; Automation in Sekunden statt Takten; volle Audio-/MIDI-Funktionen nur auf Apple; Bearbeitung zwischen Mitgliedern synchronisiert über die Cloud (braucht Internet).

## 4. Ableton-Rig (Ableton Live + AbleSet)

**Was es ist:** Kein Produkt, sondern der Profi-Standard für Playback: Ableton Live auf einem Laptop mit Mehrkanal-Interface. Jeder Song als Abschnitt im Arrangement mit Stems, Klick, Ansagen (Guide Track) und MIDI-Spuren. Seit einigen Jahren meist mit **AbleSet** (Leo Labs) als Setlist- und Bühnen-Oberfläche.

**Wie Zeitkritisches gelöst wird:** Alles liegt auf einer Zeitleiste in Ableton: Audio, Klick, MIDI-Clips mit Programmwechseln/Controllern für Amps und Synths, MIDI an ein Licht-Pult oder einen MIDI-zu-DMX-Wandler, Beat Clock an externe Geräte. Ein Gerät, eine Uhr, sample-genau. **Ableton Link** synchronisiert Tempo und Taktphase zwischen Apps und Rechnern im LAN, aber keine Song-Position.

**AbleSet:**
- Setlist aus Locatoren im Ableton-Projekt; Reihenfolge, Farben, Notizen ohne das Projekt anzufassen; ein Projekt je Song möglich.
- **Browser-Oberfläche** auf jedem Handy/Tablet im selben Netz, kein Internet, **je Gerät eigene Ansicht** (Sängerin: Titel + Text; MD: Timecode + Sprung-Knöpfe). Das ist dem StageBoard-Dashboard-Gedanken am nächsten.
- Synchrone **Liedtexte** aus MIDI-Spuren, mit Akkorden und Transponieren; Werkzeug zum Synchronisieren der Zeilen.
- Gesprochene Ansagen und Einzähler (generierte Stimme oder eigene Aufnahmen), Guide Tracks automatisch stumm, Abschnitte quantisiert loopen.
- MIDI-Mapping, OSC-Steuerung, Stream Deck, LTC-Timecode-Anzeige; Pro: **OSC-Spuren** (zeitgesteuerte OSC-Befehle an Licht, Video, Mixer), eigene Bedienflächen (Canvas), Mixer, Skripte.
- **AbleNet (Redundanz):** zwei oder mehr Rechner mit demselben Set, finden sich per Bonjour, ohne zentrale Steuerung. Startabweichungen korrigiert eine Drift-Korrektur über Abletons Phase-Nudge (nur auf dem Backup-Rechner, Clips müssen gewarpt sein); „Sync Playback Now“ richtet nach einem Absturz in einigen Sekunden neu aus. Redundante Interfaces (iConnectivity, DirectOut, DAD) schalten bei Ausfall auf den Backup-Rechner. Ethernet empfohlen.
- Preise: Intro 129 $ (1 Rechner), Standard 179 $ (2 Rechner, AbleNet, OSC), Pro 269 $ (3 Rechner, OSC-Spuren, Canvas). macOS und Windows. Unbegrenzt testbar, stoppt dann alle 15 Minuten.

**Stärker als StageBoard:** Sample-genaue Wiedergabe von Stems, Klick und MIDI auf einer Zeitleiste; Mehrkanal-Ausgabe ins In-Ear-System und an FOH; echte Redundanz mit zwei Rechnern; DAW-Werkzeuge (Warp, Tempo-Automation, Stems bearbeiten); Industriestandard bei Profi-Produktionen; OSC/LTC für Licht und Video.
**Schwächer als StageBoard:** Braucht Ableton-Kenntnisse - meist eine Person in der Band oder ein Techniker, der alles baut und pflegt; jede Änderung (Song tauschen, Text korrigieren, Cue verschieben) geht über das Ableton-Projekt auf dem Rechner, nicht über das Tablet eines Musikers. Teuer und aufwendig (Rechner, Interface, für Redundanz alles doppelt plus Umschalt-Interface). Keine Song-Bibliothek, keine Band-Verwaltung, kein Üben zu Hause mit demselben System. Hardware nur als MIDI-Kanal, keine Erkennung oder Graceful Degradation. Alles Zeitkritische weiterhin auf einem Rechner (bzw. zwei identischen); Musiker-Tablets sind reine Anzeige- und Fernbedienungen.

## 5. Prime (Loop Community)

**Was es ist:** Multitrack-Player für Worship-Teams, eng verbunden mit dem Track-Katalog von Loop Community. Nebenan der direkte Konkurrent **Playback** von MultiTracks.com mit fast gleichem Modell (siehe §5a).

**Funktionen:**
- Multitracks mit Mixer (beliebig viele Spuren), eigene Audiodateien hochladen, Tonart und Tempo ändern, Arrangements umbauen, zu Abschnitten springen und loopen (Sprung am Abschnittsende oder nach 1-2 Takten), Übergänge (Überblenden, automatisch weiter, überlappend).
- **Klick und gesprochene Band-Ansagen** („Chorus“, „Bridge“) für jeden Song gratis; eigene Ansagen aus Text erzeugt (Abo).
- Ausgabe ab zwei Kanälen (Tracks / Klick+Ansagen), Routing auf Busse, Auto-Pan; empfohlenes 8-Kanal-Interface „Track Rig“.
- **MIDI-Out (Abo):** Cues per Doppeltipp auf die Wellenform setzen, innerhalb des Abschnitts verschiebbar; Note an/aus, Programmwechsel, Controller. Ziel vor allem ProPresenter (Textfolien), Licht, Keyboards, Pedale. Hauptweg Netzwerk-MIDI (RTP) über WLAN oder Ethernet-Adapter; USB nur am Mac. **Keine MIDI Clock.** Rücksprung in einen früheren Abschnitt löst dessen Cues nicht erneut aus (Workaround: Cue an jeden Abschnittsanfang).
- MIDI-In: class-compliant Controller und Fußschalter (Looptimus), Bluetooth- und Netzwerk-MIDI.
- **Loop Connect:** WorshipTools Charts folgt dem Prime-Arrangement für die ganze Band (Akkorde), Presenter erzeugt Textfolien, Sunday Keys wechselt Keyboard-Sounds im Takt der Tracks, CCLI-Meldung automatisch.
- Stufen: Basic (gratis, 300 MB eigene Uploads), Standard (500 GB, Setlists mit 20 Mitgliedern teilen, eigene Ansagen, MIDI-Out, Routing), Plus (1 TB, 40 Mitglieder, ganze Pad-Bibliothek). Preise stehen nicht auf der Seite. Installation braucht Internet und Login; Songs liegen danach auf dem Gerät.

**Wie Zeitkritisches gelöst wird:** Wie bei BandHelper und Ableton - ein Gerät spielt alles und sendet MIDI-Cues von der eigenen Wellenform-Zeit. Andere Geräte folgen nur Setlist und Arrangement (Akkorde, Folien).

**Stärker als StageBoard:** Riesiger Katalog fertiger Multitracks mit Klick und Ansagen (der eigentliche Grund, warum Kirchen es nutzen); Mixer für Stems; Tonart/Tempo ändern live; Ökosystem für Folien, Akkorde, Keyboards, CCLI; sehr einfacher Einstieg.
**Schwächer als StageBoard:** Nur Apple; ein Abspielgerät ohne Redundanz; Musiker-Geräte nur Anzeige; MIDI ohne Gerätekenntnis und ohne Clock; Geschäftsmodell lebt vom Katalog, eigene Songs sind Nebensache; Cloud-Konto Pflicht.

### 5a. Playback (MultiTracks.com)

Gleiches Modell wie Prime: Intro gratis (eine Stereo-Ausgabe, iOS/iPadOS/macOS), Premium als Abo (laut Drittanbietern ab ca. 10 $/Monat; MIDI-Cues irgendwo im Song, Lautstärke/Mute-Automation, Pad Player, Playback Remote, Playback Sync mit ChartBuilder), Cloud Pro für eigene Tracks, Arrangements und Team-Setlists; Live Bundle (Premium + Cloud Pro + ProPresenter-MIDI-Cues) bei Sweetwater 359,88 $/Jahr, ein Gerät. Über 14.000 vorgefertigte Produktions-Cues. Für StageBoard gilt dieselbe Einordnung wie bei Prime.

## 6. Gesamtvergleich

Legende: ● stark / vorhanden · ◐ teilweise · ○ fehlt

| Merkmal | StageBoard | BandHelper | Ableton + AbleSet | Prime |
|---|---|---|---|---|
| Song-Bibliothek, ChordPro, Transponieren | ● | ● | ◐ (Texte als MIDI-Spuren) | ◐ (über WorshipTools Charts) |
| Setlists | ● | ● | ● | ● |
| Band-Verwaltung (Termine, Finanzen, Kontakte) | ○ | ● | ○ | ○ |
| Noten/PDF, Video | ○ | ● | ◐ (Video per OSC) | ○ |
| Backing-Track | ● (eine Spur je Song) | ● (8 Spuren nur Apple) | ● (beliebig viele Stems) | ● (Stems + Mixer) |
| Getrennte Ausgänge Klick/Tracks/FOH | ○ | ◐ (nur Apple) | ● | ● |
| Klick | ● (starres Raster am Track ausgerichtet) | ● | ● | ● |
| Gesprochene Ansagen / Guide Track | ○ | ○ | ● | ● |
| Tonart/Tempo des Tracks live ändern | ◐ (nur Solo-Üben) | ◐ (Latenz ~100 ms auf iOS) | ● | ● |
| Abschnitte springen/loopen in der Show | ○ | ◐ | ● (quantisiert) | ● (quantisiert) |
| Track-Katalog | ○ | ○ | ○ | ● |
| MIDI beim Songwechsel | ● | ● | ● | ● |
| MIDI-Cues im Song | ● (Zeitleiste, Raster) | ◐ (Sekunden, Automation) | ● (sample-genau) | ● (Wellenform) |
| Cue-Präzision | ◐ (je Frame abgefragt, bis ~16 ms + Uhr-Abweichung) | ◐/● (MIDI-Datei mit Audio nur Apple) | ● | ● |
| MIDI Beat Clock | ○ | ● | ● | ○ |
| OSC | ◐ (nur Ui24R-eigenes Protokoll) | ● | ● | ○ |
| Geräte mit Namen statt Port, Auto-Bindung, Graceful Degradation | ● | ○ | ○ | ○ |
| In-Ear-Mischpult direkt steuern (More Me) | ● (CQ-18T, Ui24R) | ○ | ◐ (per OSC selbst gebaut) | ○ |
| Licht | ◐ (Widget, Server-Plugin nur Attrappe) | ◐ (MIDI/OSC) | ● (MIDI/OSC/LTC) | ◐ (MIDI) |
| Eigene Ansicht je Gerät | ● (Dashboards, 27 Widgets) | ● (Layouts) | ● (Performance View im Browser) | ○ |
| **Mehrere Geräte zeitgleich (gemeinsame Uhr)** | ● | ○ (~0,5 s, „nicht für Timing“) | ◐ (nur zwischen Ableton-Rechnern; Tablets zeigen an) | ○ |
| **Jedes Gerät steuert eigene Hardware im Takt** | ● | ○ | ○ | ○ |
| **Ausfall eines Geräts überstehen** | ● (Master-Übernahme; Server bleibt Quelle) | ○ | ● (AbleNet, aber doppelte Hardware) | ○ |
| Bearbeiten im Proberaum ohne Internet | ● | ◐ (Daten offline, Sync über Cloud) | ● (lokal am Rechner) | ○ |
| Bedienung ohne Fachwissen | ◐ | ● | ○ | ● |
| Plattformen | ◐ (Android, Browser) | ● | ◐ (Mac/Windows + Browser) | ◐ (nur Apple) |
| Sprache | ◐ (Deutsch, i18n begonnen) | ● (Englisch) | ● | ● |
| Reife, Nutzerbasis | ○ (eine Band) | ● | ● | ● |
| Kosten für eine Band | offen | niedrig | hoch | niedrig (ohne Katalog) |

## 7. Was die drei gemeinsam nicht können (StageBoards Feld)

1. **Gemeinsame Show-Uhr über alle Geräte.** Jedes Gerät weiß, wo im Song die Band gerade ist, auf wenige Millisekunden genau - nicht nur, welcher Song gewählt ist.
2. **Verteilte Ausführung.** Das Gitarren-Tablet schaltet den Kemper per USB, das Drummer-Tablet spielt den Klick ins eigene Ohr, das Keyboard-Tablet sendet die Sounds - alle zur selben Song-Zeit, ohne Kabel quer über die Bühne.
3. **Kein Single Point of Failure ohne doppelte Hardware.** Der Stage-Server hält den Zustand; fällt ein Tablet aus, übernimmt ein anderes die Master-Rolle. Ableton schafft Redundanz nur mit einem zweiten Rechner und Umschalt-Interface.
4. **Geräte als Bandmitglieder-Hardware statt MIDI-Kanäle.** „Marcos Kemper“, automatisch gebunden, Widget deaktiviert sich sauber, wenn er fehlt.
5. **Alles in einem System von der Probe bis zum Gig**, bedienbar von den Musikern selbst, ohne Playback-Techniker: Bibliothek, Editor, Timeline, Üben, Show, Nachbericht.

## 8. Was StageBoard übernehmen sollte

Nach Nutzen für das eigene Feld sortiert:

1. **MIDI-Cues mit Zeitstempel senden.** WebMIDI kann eine Nachricht für einen künftigen Zeitpunkt einplanen (`output.send(data, timestamp)`). Zusammen mit dem Vorlauf von 400 ms ließen sich Cues je Gerät im Voraus übergeben statt je Frame abzufragen - ~1 ms statt bis zu ~16 ms. Schließt die eine Lücke, in der das Ein-Geräte-Modell genauer ist.
2. **Cues auf Takten statt Sekunden.** Das Raster existiert (docs/14); Cues, die am Takt hängen, wandern bei Arrangement-Änderungen mit. Keiner der drei bietet das so.
3. **MIDI Beat Clock aus dem Klick** für Drumcomputer, Delays, Looper.
4. **Gesprochene Ansagen und Guide Track** („Chorus in 2“) - in Prime und AbleSet Standard, für Bands mit In-Ears sehr gefragt.
5. **Abschnitte springen und loopen in der Show**, quantisiert auf Taktende - Standard bei Prime und AbleSet.
6. **Import von `.mid`-Dateien und Ableton-Locatoren als Cues bzw. Abschnitte** - erleichtert den Umstieg aus einem Ableton-Rig.
7. **Getrennte Ausgänge für Klick und Track** (z. B. links/rechts oder USB-Interface am Tablet), damit Klick nur ins In-Ear geht.
8. **OSC als generischer Sender** für Licht- und Video-Software.
9. Später: Stems mit Mixer statt einer Spur je Song (in docs/12 als „geplant“ geführt).

## Quellen

- [BandHelper: Funktionen](https://www.bandhelper.com/main/features.html)
- [BandHelper: Preise](https://www.bandhelper.com/main/pricing_upcoming.html)
- [BandHelper: Live Sharing](https://www.bandhelper.com/tutorials/live_sharing.html)
- [BandHelper: MIDI oder OSC senden](https://www.bandhelper.com/tutorials/sending_MIDI.html)
- [BandHelper: Automationsspuren](https://www.bandhelper.com/tutorials/automation_tracks.html)
- [BandHelper: Erweiterte Audio-Funktionen](https://www.bandhelper.com/tutorials/advanced_audio.html)
- [AbleSet](https://ableset.com/)
- [AbleSet: AbleNet](https://ableset.com/docs/ablenet/)
- [AbleSet 3 bei Isotonik Studios](https://isotonikstudios.com/product/ableset-3-by-leolabs/)
- [Ableton Link](https://www.ableton.com/en/link/)
- [Ableton-Forum: Ableton mit einer Rockband](https://forum.ableton.com/viewtopic.php?p=784421)
- [Fractal-Forum: Presets per Backing-Track schalten](https://forum.fractalaudio.com/threads/using-backing-tracks-to-trigger-preset-scene-changes-w-bandhelper.125461/)
- [Prime MultiTrack App](https://loopcommunity.com/prime-multitrack-app)
- [Prime: MIDI-Out](https://loopcommunity.com/blog/2019/11/how-to-use-midi-out-with-prime/)
- [Loop Connect](https://loopcommunity.com/loop-connect)
- [MultiTracks: Playback-Abos](https://intercom.help/multitracks/en/articles/8106819-playback-subscriptions-explained)
- [MultiTracks: Playback](https://multitracks.com/playback)
- [Sweetwater: MultiTracks Live Bundle](https://www.sweetwater.com/store/detail/MTLiveBun--multitracks-live-playback-bundle)
