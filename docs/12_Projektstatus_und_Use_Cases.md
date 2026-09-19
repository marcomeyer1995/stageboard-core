# StageBoard - Projektstatus, Fähigkeiten und Use Cases

Stand: 2026-09-19, `main` @ `e265c88` (nach #242, #243, #245). Grundlage ist der gelesene Quelltext; die drei Teile unten wurden aus dem Code erhoben und stichprobenartig gegengeprüft (Transposition fehlt, kein Client sendet `scheduledAt`, Master schreibt lokale `Date.now()`, 34 offene Issues). Nichts davon wurde neu auf Tablets getestet.

## 1. Kurzfassung

StageBoard ist ein lokal-first arbeitendes Live-System für Bands: ein Stage-Server (Fastify + CouchDB, Linux, nativ) und React-PWAs auf den Tablets, verbunden über ein lokales Netz. Der **Kern läuft und ist im Einsatz**: mehrere Bands mit Konten/Rollen, Song-Bibliothek mit ChordPro-Editor, Setlists, ein synchroner Prompter, Backing-Tracks mit Offline-Cache, ein synthetisierter Klick samt Beat-Grid, NTP-artige Uhr-Synchronisation, Zeitleisten-Cues, Hardware-Erkennung und -Bindung (Kemper, Boss RC-500, NUX MG-30, A&H CQ-18T, Soundcraft Ui24R, generisches WebMIDI), ein anpassbares Dashboard mit 23 Widgets sowie Nachbericht und Backups. **Solo Üben** und **Gig** sind zwei getrennte Modi; seit dieser Woche gibt es zusätzlich pro Setlist-Eintrag einen **Übergangstyp** (manuell / nächster bereit / nahtlos / mit Pause).

### Reifegrad auf einen Blick

| Bereich | Stand |
|---|---|
| Bands, Beitritt, Roster, PINs, Geräte-Ledger | fertig |
| Bibliothek, Song-Editor, ChordPro, Tap-to-Sync, Tab-Import | fertig (UG-Scraper fragil) |
| Setlists, Queue, Master-Token, Solo/Gig | fertig (kein Master-Heartbeat) |
| Prompter, Metronom, Klick, Beat-Erkennung | fertig |
| Backing-Tracks, Offline-Cache, Audio-Resume | fertig (Übergänge noch nicht auf Tablet geprüft) |
| Hardware-Erkennung/-Bindung, Cue-Timeline | fertig, aber Polling (~60 fps), nicht sample-genau |
| Server-Plugins (Mixer/Licht/Playback/Backup/Click) | nur Mocks |
| Stems, YouTube-Extraktion, Transposition/Capo, Festival-Clock, Show-Flow-Items, Crossfade | geplant, nicht gebaut |

### Wichtigste Lücken und Risiken

1. **Keine Zugriffskontrolle im LAN:** Audio-Upload/-Löschung, Plugin-Trigger, Geräte-Relay und Discovery sind unauthentifiziert (Modell: "wer im Band-WLAN ist, vertraut sich"). Relevant, sobald ein fremdes Venue-WLAN genutzt wird. CouchDB-Default-Zugang ist `admin/admin`, wenn nichts gesetzt ist.
2. **Master-Token ohne Heartbeat/Force-Override (#32):** Fällt das Master-Tablet aus, muss jemand manuell übernehmen; "Übernehmen" ist ungeschützt.
3. **Uhr-Basis beim Transportstart:** Der Master schreibt `Date.now()` seiner eigenen Uhr, Leser rechnen mit Serverzeit. Stimmt nur, wenn die Master-Systemuhr nahe an der Server-Uhr liegt (Code-Lesart, nicht live gemessen).
4. **Übergänge (#232) ungetestet auf Hardware:** Nahtlos hängt an lokaler Audio-Ausgabe und daran, dass Master und Audio-Tablet dasselbe Gerät sind. Ob ein Gig-Modus-`delayed`-Start einen Einzähler bekommt, ist offen.
5. **Doku teilweise veraltet:** `docs/05` führt einige inzwischen ausgelieferte Issues noch als offen.

### Kleine Unstimmigkeiten (nur beobachtet)

- Widget "Aktive Setlist" zeigt in Solo Üben weiterhin die Gig-Setlist.
- "Dashboard-Umschalter" hat `dashboardIds` im Schema, aber keine Oberfläche dafür.
- `mock-backup` und `mock-click` sind im Client installierbar, laufen serverseitig aber ins Leere.

---

## Teil A - Widgets (23 Typen)

Stand: Code auf `main` (nach #245). Alle Angaben aus dem Quelltext verifiziert. Quelle für Registrierung: `widgets/registry.tsx` (23 Widget-Typen).

### Gemeinsame Mechanik

- **Registry (`registry.tsx`):** Jedes Widget wird per `defineWidget` mit Typ, Titel, Beschreibung, `requires` (Capabilities), `category`, `relevantRoles`, `defaultLayout` (Grid-Größe mit min/max), `configSchema` (Zod), `Component`, `ConfigPanel` und optional `Preview` (statische Galerie-Vorschau) registriert. Die Config wird einmal geparst; bei ungültiger/älterer/neuerer Config fällt sie auf die Schema-Defaults zurück (ein Dashboard-Dokument kann die Live-Ansicht nie zum Absturz bringen).
- **Kategorien:** `performance`, `monitoring`, `show-control`, `system-crew`, `utility`, `post-show` (aktuell hat kein Widget `post-show`).
- **Graceful Degradation (`components/WidgetFrame.tsx`):** Ist der Status einer Capability `degraded` (Plugin installiert, aber nicht erreichbar), bleibt das Widget an seinem Platz, wird zu 50 % transparent, inert (`pointer-events-none`) und zeigt ein „⃠ Offline"-Badge. Im Edit-Modus ist jedes Widget inert und wird zum Drag-Handle; das „⋯"-Menü (oder Doppelklick) öffnet Config-Panel, „Entfernen" und – wenn vom Dashboard angeboten – den Rahmen-los-Schalter.
- **Größen:** Praktisch alle Widgets nutzen `SizeRatioSlider` (25 %–400 % des geräteweiten Standards „Textgröße", `useContentFontSizeStore.baseFontSize`) – kein Auto-Fit mehr (siehe Memory „Widget font auto-fit"). Listen-Widgets nutzen `ContentFontSizeConfigSchema` (`sizeRatio`, Default 1).
- **Modus-Weiche `useShowMode()`:** Alle Queue-/Transport-Widgets lesen Queue, Uhr und Aktionen über `useShowMode()`. Gig: synchronisierter `ShowState`, Steuerung nur mit Master-Token (`canControl`). Practice (Solo Üben): rein lokaler Zustand (`usePracticeStateStore`), `canControl` immer `true`, Audio immer über das eigene Gerät.
- **Hardware-Routing (Cue-/Mixer-Widgets):** Reihenfolge: HardwareSetup-Binding (lokales Tablet → `local-mine`, anderes Tablet → Relay `triggerDeviceControl` → `local-other`) → sonst Plugin über `pluginProviding` → sonst nichts.

Legende Modus-Spalte: „beide" = verhält sich in Gig und Practice über `useShowMode()`; „nur Gig" / „modusunabhängig" explizit vermerkt.

---

### Kategorie: performance

#### 1. Prompter (`prompter`)
- **Was:** Zeigt Titel, Interpret und den ChordPro-Text (Akkorde + Lyrics) des aktuellen Songs bzw. der aktuellen Variante. Zwei Ansichten: **Smooth Scroll** (die aktive Zeile wird pro Tick sanft zur Mitte gezogen, Easing-Faktor 0,08) und **Paginated View** (Seitenwechsel je Abschnitt, Kopfzeile mit Abschnittsname, `n/m` und „next: …"). Key/Tuning/Capo der Variante erscheinen als erste, mitscrollende Zeile. Kommentar-Zeilen (`{comment:}`/`{c:}`, gezielt `{cc4<Name>:}`) werden je aktivem Profil gefiltert (nicht adressierte Kommentare sind gar nicht Teil des Songs; unbekannte Ziel-Namen bleiben sichtbar).
- **Config:** `viewMode` (`scroll`|`paginated`, Default `scroll`), `sizeRatio` (Anker-Textgröße) und relative Verhältnisse `chordSizeRatio` (0,7), `titleSizeRatio` (2), `artistSizeRatio` (0,9), `sectionLabelSizeRatio` (1,1, nur Paginated), `arrangementInfoSizeRatio` (0,6), `commentSizeRatio` (0,7).
- **Gig vs. Practice:** beide. Gig: Uhr ist ShowState-synchron (alle Tablets scrollen zum selben Wert). Practice: lokale Uhr. `elapsedMs` ist `null`, wenn nichts läuft → Anzeige bleibt am Songanfang.
- **Disabled/Degradation:** Kein Song → „Keine Songs vorhanden". Keine Capability nötig, kann nie ausgegraut werden.
- **Capability:** keine (Kernwidget).
- **Use Cases:** (1) Sängerin liest während des Gigs auf dem Tablet auf dem Notenständer den Text mit Akkorden, der Prompter scrollt synchron zum Backing-Track. (2) Gitarrist stellt auf Paginated um, weil er lieber Abschnittsweise blättern lässt, und sieht „next: Bridge" vorab; ein an ihn gerichteter `{cc4marco:}`-Kommentar („Solo 8 Takte") erscheint nur bei ihm.

#### 2. Live-Queue (`live-queue`)
- **Was:** Seitenleiste mit der **ganzen** Setlist: bereits gespielte Songs ausgegraut, aktueller hervorgehoben (scrollt in die Mitte), Rest darunter. Pro Zeile „⋯"-Menü („Als nächstes spielen", „Aus Queue entfernen") und Drag-Handle „⠿" zum Umsortieren (dnd-kit) – nur für noch nicht gespielte Zeilen. Änderungen schreiben in das echte Setlist-Dokument (`saveSetlist`).
- **Config:** `sizeRatio` (Textgröße, Default 1).
- **Gig vs. Practice:** seit #234 modusabhängig über `useShowMode()`. Gig: aktive Setlist aus ShowState. Practice: die im Menü „Modus" gewählte Übungs-Setlist, ohne Auswahl der **ganze Katalog** (eine Zeile pro Song). Reorder/Entfernen nur, wenn es ein echtes Setlist-Dokument gibt (`canControl && activeSetlist`) – im synthetischen Katalog-Modus deaktiviert. Beachte: In Practice bearbeiten diese Aktionen das gemeinsame Setlist-Dokument für alle. „Master übernehmen"-Button nur im Gig, wenn das Gerät nicht Master ist.
- **Disabled/Degradation:** Leere Liste → „Keine Songs in der Setlist." bzw. „Keine Setlist aktiv." Nicht-Master sieht die Liste, kann aber nichts ändern.
- **Capability:** keine. Hat eine statische `Preview` für die Widget-Galerie.
- **Use Cases:** (1) Bassist sieht im Blick, dass nach dem aktuellen Song noch fünf folgen, und scrollt zurück, um zu sehen, was schon lief. (2) Bandleader zieht per Drag einen Song hoch, weil das Publikum gerade steil geht – „Als nächstes spielen" macht das in einem Tipp; (3) Solo-Üben: Gitarrist wählt „Setlist zum Üben" und trainiert das ganze Set der Reihe nach, ohne die Show-Setlist der Band anzufassen.

#### 3. Next Song (`next-song`)
- **Was:** Eine Zeile: „Aktuell: <Titel> (Variante) | Next: <Titel> (BPM) (Variante)". Buttons „‹ Zurück" und „Weiter ›" (deaktiviert ohne Vorgänger/Nachfolger). Ohne Kontrolle statt der Buttons „Master übernehmen".
- **Config:** `sizeRatio` (Default 1,5).
- **Gig vs. Practice:** beide (`next`/`previous` aus `useShowMode()`); Gig nur mit Master-Token, Practice immer.
- **Disabled/Degradation:** Ohne Songs „Keine Songs vorhanden". Ohne Kontrolle nur der Master-Übernehmen-Button.
- **Capability:** keine.
- **Use Cases:** (1) Drummer sieht, welcher Song mit welchem Tempo als Nächstes kommt, und stellt sich vor dem Zählen ein. (2) Bandleader (Master) schaltet per „Weiter ›" durch die Setlist; der Keyboarder, dessen Tablet gerade nicht Master ist, sieht dieselbe Anzeige, kann aber nur „Master übernehmen".

#### 4. Aktive Setlist (`active-setlist`)
- **Was:** Anzeige des Namens der aktuell aktiven Gig-Setlist plus „n Songs"; sonst „Keine".
- **Config:** `sizeRatio` (Default 1,5).
- **Gig vs. Practice:** **nur Gig** – liest `useQueue()` (ShowState), nicht `useShowMode()`. In Solo Üben zeigt es weiterhin die Gig-Setlist (nicht auf Practice umgestellt).
- **Disabled/Degradation:** „Keine", solange keine Setlist aktiv ist.
- **Capability:** keine.
- **Use Cases:** (1) Ein reduziertes Dashboard ohne Queue zeigt dem Techniker trotzdem, welche Setlist heute läuft („Sommerfest 2026"). (2) Kurz vor dem Gig prüft der Bandleader mit einem Blick, dass nicht versehentlich die Probe-Setlist aktiv ist.

#### 5. Show-Transport (`show-transport`)
- **Was:** Play/Pause/Stop/Reset für den aktuellen Song plus Songtitel (mit Variante) und laufende Uhr (`mm:ss`, negativ während des Einzählens). Zeigt „Audio läuft über ein anderes Gerät", „Kein Track angehängt", „Verlängert – läuft über die reguläre Länge hinaus" (#231-Extend) sowie Fehler des Audio-Treibers. Die eigentliche Audio-/Click-Ansteuerung liegt nicht im Widget, sondern in Treibern (`useAudioOutputDriver`, `useAutoStopDriver`, …), die einmal in `App.tsx` laufen – ein Tabwechsel unterbricht die Wiedergabe nicht.
- **Config:** `titleSizeRatio` (Titel & Uhr, 1,8), `buttonsSizeRatio` (1,2).
- **Gig vs. Practice:** beide. Gig: Play/Pause/Stop nur mit Master-Token; Audio über ein `audio-playback`-Plugin, ein per HardwareSetup gebundenes Tablet oder gar nicht (kein stiller Fallback auf den Tablet-Lautsprecher). Practice: immer lokales Audio (`localAudioEngine`). Am Ende des Tracks greift die Übergangsart des Setlist-Eintrags (#232: manuell / nächster bereit / nahtlos / mit Pause) – über `useAutoStopDriver`, nicht im Widget selbst.
- **Disabled/Degradation:** Kein Song → „Kein Song aktiv". Nicht-Master → Hinweistext + „Master übernehmen". Plugin-Fehler werden rot angezeigt.
- **Capability:** keine im Registry (`requires: []`); nutzt `audio-playback` per Routing, degradiert aber selbst.
- **Use Cases:** (1) Der Master-Tablet-Halter drückt „Play"; Backing-Track startet über das Server-Plugin, und die Prompter aller Tablets scrollen los. (2) Solo-Üben: Sängerin übt zu Hause mit „Play/Pause" auf dem eigenen Tablet über Kopfhörer, „Reset" bringt sie an den Songanfang.

#### 6. Visueller Metronom (`visual-metronome`)
- **Was:** Blitzt im Takt des aktiven Songs, aus derselben synchronen Uhr wie der Prompter (kein lokaler `setInterval`). Stil `number`: große Beat-im-Takt-Zahl, ganzes Feld blitzt (Downbeat in Akzentfarbe, Einzählen gedämpft); Stil `beat-dots`: Punktreihe über den Takt, aktueller Beat leuchtet. Darunter „<BPM> · <Taktart>" (BPM auf eine Nachkommastelle, effektives Tempo inkl. Beat-Anker-Korrektur und Live-Korrektur „(+x%)"). Vor Start „Wartet auf Play", während Einzählen ohne Grid „Einzählen…".
- **Config:** `style` (`number`|`beat-dots`, Default `number`), `sizeRatio` (3,5; nur für `number`).
- **Gig vs. Practice:** beide (`useShowMode()`); Live-Tempo-Korrektur nur im Gig wirksam.
- **Disabled/Degradation:** Kein Song → „Kein Song aktiv". Keine Capability nötig. Hat eine statische `Preview`.
- **Capability:** keine.
- **Use Cases:** (1) Drummer ohne In-Ear-Klick sieht den Beat im Augenwinkel. (2) Sänger nutzt die Punkte-Ansicht, um bei ungeraden Takten (z. B. 6/8) die Taktform zu sehen.

#### 7. Tempo-Korrektur (`tempo-nudge`)
- **Was:** Live „−"/„+" (1 %-Schritte, Grenze `LIVE_TEMPO_ADJUST_LIMIT_PERCENT`) auf das Click-/Metronom-Tempo, ohne das gespeicherte BPM des Songs zu ändern; „Zurücksetzen"-Link bei ≠ 0 %.
- **Config:** `sizeRatio` (2,2).
- **Gig vs. Practice:** **nur Gig**. In Practice zeigt das Widget „Nur im Gig-Modus verfügbar" (Übungs-Tempo ist Aufgabe des späteren Speed-Trainers #61). Änderungen sind Master-gesteuert (`canControl`).
- **Disabled/Degradation:** Buttons deaktiviert ohne Master bzw. an den Grenzen.
- **Capability:** keine.
- **Use Cases:** (1) Die Band drückt live merklich, der Bandleader nimmt 3 % raus, damit Klick/Metronom folgen. (2) Nach dem Song „Zurücksetzen", damit der nächste Song wieder mit dem Original-Tempo startet (die Korrektur wird beim Songwechsel ohnehin auf 0 zurückgesetzt).

#### 8. Klick (`click-track`)
- **Was:** Status und Override des synthetisierten Click-Generators (#25). Zeigt „An"/„Aus" (aus `effectiveClickEnabled` der Song-Vorgabe plus Override) und drei Buttons „Standard / An / Aus". Der Web-Audio-Scheduler läuft in `useClickOutputDriver` (einmal in `App.tsx`), nicht im Widget. Kennzeichnet „· dieses Gerät", wenn dieses Tablet die Klick-Ausgabe ist.
- **Config:** `sizeRatio` (3).
- **Gig vs. Practice:** beide. Gig: Override ist geteilter ShowState-Wert (Master-gesteuert, von jedem Tablet aus). Practice: lokaler, ungegateter Override.
- **Disabled/Degradation:** Kein Routing (`engine === 'none'`) → „Kein Klick-Ausgabegerät eingerichtet". Buttons deaktiviert ohne Kontrolle.
- **Capability:** `click-track` per Routing (nicht im `requires`).
- **Use Cases:** (1) Für einen Song ohne Klick-Vorgabe schaltet der Drummer den Klick spontan „An" (für seine IEM). (2) Solo-Üben: Gitarrist trainiert mit fest eingeschaltetem Klick, unabhängig von der Song-Einstellung.

#### 9. Track-Wahl (`track-override`)
- **Was:** Dropdown, um kurzfristig einen anderen Backing-Track der aktuellen Variante zu wählen („Standard (Setlist)" oder ein konkreter Track), ohne die Setlist zu ändern.
- **Config:** `sizeRatio` (1).
- **Gig vs. Practice:** beide. Gig: Master-gesteuert, geteilt (alle hören denselben Feed). Practice: rein lokal.
- **Disabled/Degradation:** Ohne Tracks „Kein Track angehängt"; bei nur einem Track „Nur ein Track vorhanden – kein Wechsel nötig"; Dropdown deaktiviert ohne Kontrolle.
- **Capability:** keine.
- **Use Cases:** (1) Heute fehlt der zweite Gitarrist – der Techniker/Master schaltet auf den Track „1 Gitarre" statt „keine Gitarre". (2) Solo-Üben: Bassist wählt den Track „ohne Bass", um zum Rest der Band zu spielen.

#### 10. Fußtaster (`midi-status`)
- **Was:** Zeigt den WebMIDI-Status („Kein WebMIDI" / „Kein Fußtaster" / „Fußtaster verbunden") und einen Button „Fußtaster simulieren", der `jumpToNextSection` auslöst (Sprung zum nächsten Song-Part). 
- **Config:** `sizeRatio` (1,3).
- **Gig vs. Practice:** modusunabhängig (`useMidiTrigger`, WebMIDI auf dem Gerät).
- **Disabled/Degradation:** `requires: [midi-input]` – Status kommt clientseitig aus dem WebMIDI-Probe; ohne Gerät wird der Status grau angezeigt.
- **Capability:** `midi-input`.
- **Use Cases:** (1) Gitarrist hat einen MIDI-Fußtaster am Tablet; das Widget zeigt ihm vor dem Gig, ob er erkannt wurde. (2) Beim Soundcheck testet die Crew den Ablauf ohne Fußtaster über „Fußtaster simulieren".
- **Hinweis:** Der Button ist ein Test-/Simulationshilfsmittel; ob der echte Tastendruck weitere Aktionen auslöst, hängt an `useMidiTrigger` außerhalb der Widgets (hier nicht vertieft).

#### 11. Dashboard-Umschalter (`dashboard-switcher`)
- **Was:** Große Buttons zum Wechsel zwischen Dashboards (Stationen), aktives hervorgehoben. Private Stationen erscheinen nur für ihren Besitzer (`isDashboardVisible`).
- **Config:** `orientation` (`horizontal`|`vertical`), `sizeRatio` (1,3). Das Schema hat außerdem `dashboardIds` (Liste oder `null` = alle), das **Config-Panel bietet dafür keine Auswahl** – nur per Dokument setzbar.
- **Gig vs. Practice:** modusunabhängig.
- **Disabled/Degradation:** keine Capability; leere Liste, wenn keine sichtbaren Dashboards.
- **Capability:** keine.
- **Use Cases:** (1) Sänger wechselt mitten im Set von seiner „Lyrics"-Station zur „Ansagen"-Station. (2) Techniker hat unten eine vertikale Leiste, um zwischen Mix-, Licht- und Status-Dashboard zu springen.

---

### Kategorie: monitoring

#### 12. More Me (IEM) (`iem-more-me`)
- **Was:** Drei vertikale Fader „Mein Gesang", „Meine Gitarre", „Band" (0–100, Start 60). Senden pro Änderung `set_volume` mit `{channel, volume}`. Der Fader bewegt sich sofort (optimistisch).
- **Config:** `sizeRatio` (0,9).
- **Gig vs. Practice:** modusunabhängig (kein `useShowMode`). Routing: HardwareSetup-`mixer`-Binding (lokal → Translator, anderes Tablet → Relay; Pegel dann aus dem gemeinsamen `useLocalMixerStore`) sonst Plugin (`triggerShowControl`).
- **Disabled/Degradation:** `requires: [mixer]`; bei nicht erreichbarem Plugin ausgegraut (WidgetFrame). Fehler werden rot angezeigt.
- **Capability:** `mixer`.
- **Use Cases:** (1) Sängerin dreht sich „Mein Gesang" im In-Ear lauter, ohne den Mischer anzufassen. (2) Gitarrist holt sich die Band im Ohr leiser, nachdem das Intro zu laut war.
- **Hinweis:** Die Kanalnamen sind im Code fest (`CHANNELS`), nicht konfigurierbar.

---

### Kategorie: show-control

#### 13. Quick Actions (`quick-actions`)
- **Was:** 2-spaltiges Raster großer Buttons für ad-hoc Show-Cues: „Strobo", „Blackout", „Kaltfunken", „Talkback" (feste Liste im Code). Zuletzt gedrückter Button bleibt hervorgehoben. Feuert `ShowControlEvent { type }`.
- **Config:** `sizeRatio` (1,1).
- **Gig vs. Practice:** modusunabhängig. Routing wie Lichter: ein `lighting`-Binding des HardwareSetup übernimmt (lokal/Relay), sonst ein `show-control`-Plugin.
- **Disabled/Degradation:** `requires: [show-control]`; ausgegraut bei unerreichbarem Plugin; Fehler rot.
- **Capability:** `show-control`.
- **Use Cases:** (1) Bei der Zugabe drückt der Lichttechniker „Strobo". (2) Talkback zum Mischer aus der Band heraus.

#### 14. Lighting Cues (`lighting-cues`)
- **Was:** Wie Quick Actions, aber Licht-Cues „Voll", „Dimmen", „Chase", „Farbwechsel" (fest im Code). Zeigt bei lokaler Ausführung „Zuletzt: <Cue>".
- **Config:** `sizeRatio` (1,1).
- **Gig vs. Practice:** modusunabhängig; Routing über `lighting`-Binding oder Plugin.
- **Disabled/Degradation:** `requires: [lighting]`; ausgegraut bei unerreichbarem Plugin.
- **Capability:** `lighting`.
- **Use Cases:** (1) Drummer schaltet per Button von „Dimmen" (Ballade) auf „Voll". (2) Techniker testet vor dem Gig alle Cues am DMX-Pult.

#### 15. Trigger-Button (`custom-trigger`)
- **Was:** Frei konfigurierbarer Button für ein gewähltes Logical Device. `momentary` feuert `active: true` beim Drücken und `active: false` beim Loslassen (auch bei Verlassen des Buttons); `latching` schaltet um und sendet `on: true/false`. Der Payload ist frei (JSON), wird beim Feuern gelesen und mit dem Schaltzustand zusammengeführt. Spezialfall `commandType: 'click.extend'`: Config-Panel zeigt zusätzlich „Takte" (#231 – schiebt das Track-Ende um N Takte).
- **Config:** `label` (Default „Trigger"), `color` (`neutral|accent|green|amber|red`), `behavior` (`momentary` Default | `latching`), `targetLogicalDeviceId`, `commandType` (Default `trigger`), `commandPayloadJson` (Default `{}`), `sizeRatio` (1,8). Ungültiges JSON wird im Panel markiert, blockiert aber das Tippen nicht.
- **Gig vs. Practice:** modusunabhängig als Widget; `click.extend` wählt intern Gig (Master-gesteuert) oder Practice (ungegatet) je nach `useAppModeStore`.
- **Disabled/Degradation:** Ohne Zielgerät ist der Button deaktiviert, Hinweis „Kein Zielgerät konfiguriert". `requires: []` – die Verfügbarkeit hängt am gewählten Gerät (kein WidgetFrame-Ausgrauen über Capability).
- **Capability:** keine fest; abhängig vom gewählten Logical Device.
- **Use Cases:** (1) Latching-Button „Nebel" schaltet die Nebelmaschine an/aus. (2) `click.extend` mit 4 Takten: Der Drummer verlängert das Outro live, wenn die Band noch jammt – auch von einem Fußtaster aus, sobald der auf denselben Command gebunden ist.

---

### Kategorie: system-crew

#### 16. System-Status (`system-health`)
- **Was:** Ampelliste aller Capabilities der installierten Plugins (Online / Gestört / Fehlt) plus „Uhrzeit-Sync" mit dem Stage-Server (Offset, Drift, „vor n s"; Drift > 15 ms wird amber).
- **Config:** `sizeRatio` (Textgröße, Default 1).
- **Gig vs. Practice:** modusunabhängig.
- **Disabled/Degradation:** Ohne Plugins „Keine Plugins installiert."; vor dem ersten Sync „Noch nicht synchronisiert".
- **Capability:** keine. `relevantRoles: ['crew']` (wird dem Crew-Profil bevorzugt angezeigt).
- **Use Cases:** (1) Beim Aufbau prüft der Techniker, ob Mixer- und Licht-Plugin online sind (Cockpit-Ampel, Use Case 3.1). (2) Beim Soundcheck sieht er, ob die Tablets sauber mit der Server-Uhr synchron sind.

#### 17. Sync-Check (`sync-check`)
- **Was:** Die ganze Fläche invertiert sich bei jeder synchronisierten Sekunde (aus `getServerTime()`), dazu Serverzeit mit Millisekunden, Offset und Drift dieses Geräts. Zwei Tablets nebeneinander sollten im Gleichtakt blinken.
- **Config:** `sizeRatio` (2).
- **Gig vs. Practice:** modusunabhängig.
- **Disabled/Degradation:** Offset/Drift erst nach dem ersten Sync sichtbar.
- **Capability:** keine. `relevantRoles: ['crew']`.
- **Use Cases:** (1) Techniker hält zwei Tablets nebeneinander und sieht sofort, ob sie synchron blitzen. (2) Fehlersuche bei „Prompter läuft bei einem Tablet nach": Foto/Video der Ms-Anzeige.

#### 18. Show-Notizen (`show-notes`)
- **Was:** Live-Notizen von Band und Crew zur aktuellen Show (neueste zuerst), mit Autor; Eingabezeile + „Hinzufügen" (Enter geht auch). Nicht Master-gebunden. Notizen landen im ShowLog und sind später im Nachbericht sichtbar.
- **Config:** `sizeRatio` (Textgröße, Default 1).
- **Gig vs. Practice:** modusunabhängig; nutzt das (Gig-)ShowLog.
- **Disabled/Degradation:** Ohne aktive Show „Noch keine Show aktiv." und Eingabe deaktiviert; ohne Notizen „Noch keine Notizen."
- **Capability:** keine.
- **Use Cases:** (1) Techniker tippt „Gitarre im 3. Song zu laut" und prüft es nach der Show. (2) Sänger notiert „Intro zu schnell", damit es in der Nachbesprechung auftaucht.

#### 19. Backup-Status (`backup-status`)
- **Was:** Glanceable Punkt + Text: „Backup online" / „Backup nicht erreichbar" / „Kein Backup-Plugin".
- **Config:** `sizeRatio` (1,3).
- **Gig vs. Practice:** modusunabhängig.
- **Disabled/Degradation:** `requires: [backup]` – ohne erreichbares Plugin ausgegraut; der Text unterscheidet die drei Zustände selbst.
- **Capability:** `backup`.
- **Use Cases:** (1) Crew sieht vor Showbeginn, dass das Backup-Ziel erreichbar ist. (2) Nach dem Gig prüft der Bandleader, ob das Backup lief (die Details liegen im „Backup"-Modus, nicht im Widget).

---

### Kategorie: utility

#### 20. Stimmgerät (`tuner`)
- **Was:** Chromatisches Stimmgerät über das Tablet-Mikrofon (`getUserMedia`, Autokorrelation `detectPitch`, geglättet über `PitchHistory`). Zeigt Notenname, Cents-Abweichung/Hz und einen Farb-Meter. Start per „Mikrofon aktivieren", Stopp per „Aus".
- **Config:** `minRms` (Empfindlichkeit, 0,0005–0,1, Default 0,007; im Panel als log-skalierter, invertierter Regler), `smoothingWindow` (50–150, Default 100), `noteNaming` (`sharp`|`flat`), `referenceFrequency` (400–480 Hz, Default 440), `noteSizeRatio` (8), `meterSizeRatio` (3).
- **Gig vs. Practice:** modusunabhängig.
- **Disabled/Degradation:** Interne Zustände: Idle, „Warte auf Mikrofon-Zugriff…", „Kein Zugriff aufs Mikrofon.", „Mikrofon wird … nicht unterstützt.", und im unsicheren Kontext (HTTP im LAN) ein Hinweis auf HTTPS/localhost. Keine Capability nötig. Hat eine statische `Preview`. Mindestgröße 6×12 Grid-Einheiten (sonst unleserlich).
- **Capability:** keine.
- **Use Cases:** (1) Gitarrist stimmt zwischen zwei Songs auf dem Bühnen-Tablet. (2) Band, die auf 442 Hz stimmt, stellt die Referenzfrequenz um und alle Tablets zeigen dasselbe an (jedes Dashboard-Widget einzeln konfiguriert).

#### 21. Uhr (`clock`)
- **Was:** Große Digitaluhr mit Sekunden (lokale Zeit, `de-DE`).
- **Config:** `sizeRatio` (3).
- **Gig vs. Practice:** modusunabhängig; lokale Gerätezeit (nicht die synchronisierte Serverzeit – dafür gibt es den Sync-Check).
- **Disabled/Degradation:** keine.
- **Capability:** keine.
- **Use Cases:** (1) Bandleader hält das Festival-Zeitfenster im Blick. (2) Sänger sieht die Uhrzeit für Ansagen („Noch 10 Minuten").

#### 22. Trenner (`separator`)
- **Was:** Eine einfache Linie zur optischen Gliederung eines Dashboards. Kein Inhalt, keine Interaktion.
- **Config:** `orientation` (`horizontal`|`vertical`), `color` (`neutral|accent|green|amber|red`, Default `neutral`).
- **Gig vs. Practice:** modusunabhängig.
- **Disabled/Degradation:** keine. Standardgröße 12×1; das Dashboard kann den Rahmen ausblenden (`frameless`).
- **Capability:** keine.
- **Use Cases:** (1) Trennt im Dashboard den Performance-Bereich (Prompter) vom Technik-Bereich. (2) Farbige vertikale Linie zwischen zwei Widget-Spalten.

#### 23. Geräte-Status (`device-status`)
- **Was:** Verbindungsstatus **eines** ausgewählten Logical Device: Gerätename plus „Online / Nicht erreichbar / Nicht verbunden". Löst das gebundene Plugin des Geräts auf (Fallback `pluginProviding`), sodass zwei Geräte mit gleicher Capability (#149) je ihren eigenen Status zeigen.
- **Config:** `logicalDeviceId`, `sizeRatio` (1,5).
- **Gig vs. Practice:** modusunabhängig.
- **Disabled/Degradation:** Ohne Auswahl „Kein Gerät ausgewählt".
- **Capability:** keine fest; abhängig vom gewählten Gerät (bezieht `midi-input`-Status clientseitig).
- **Use Cases:** (1) Techniker hat je ein Widget für „Mischpult links" und „Mischpult rechts". (2) Bandleader sieht per Punkt, ob der Licht-Controller verbunden ist.

---

### Nicht-Widgets in `widgets/`
- `SizeRatioSlider.tsx` (Regler 25–400 %, Schritt 5, debounced Commit gegen PouchDB-Schreib-Stottern), `ContentFontSizeConfigPanel.tsx`, `widgetColors.ts` (Farbvokabular), `CueGrid.tsx` (gemeinsames Button-Raster für Quick Actions/Lighting Cues), `*Config.ts` (Zod-Schemata).

### Auffälligkeiten / Lücken (nur beobachtet, nicht geändert)
1. **Aktive Setlist** liest immer die Gig-Setlist – in Solo Üben nicht auf die Übungs-Setlist umgestellt (im Gegensatz zu Live-Queue seit #234).
2. **Dashboard-Umschalter:** `dashboardIds` (Auswahl bestimmter Dashboards) existiert im Schema, hat aber kein UI im Config-Panel.
3. **Quick Actions / Lighting Cues / More Me:** Aktionen bzw. Kanäle sind fest im Code (nicht konfigurierbar).
4. **Fußtaster-Widget** enthält einen Test-/Simulier-Button; die eigentliche Fußtaster-Logik lebt in `useMidiTrigger` (nicht Teil dieser Bestandsaufnahme).
5. Kategorie `post-show` ist definiert, aber von keinem Widget belegt.
6. Kein Widget in `widgets/` implementiert Transition-Notes/Show-Flow-Items (#29) oder Festival Clock (#28).

---

## Teil B - Oberfläche, Bands/Konten, Stores

Stand: main nach PR #245 (Übergangstypen), 2026-09-19. Grundlage: gelesener Code in `components/`, `store/`, `App.tsx`, `lib/modes.ts` sowie die Schema-Dateien in `shared-types`. Widgets (`widgets/`) sind bewusst **nicht** Teil dieses Surveys (nur ihre Einbindung: Dashboard, Widget-Bibliothek, Edit-Modus). Das Backend wurde nicht gelesen; Aussagen über Server-Verhalten stammen ausschließlich aus Kommentaren der Client-Dateien und sind als „laut Code-Kommentar" markiert.

Legende: **Gating** = wer/was die Funktion freischaltet. **UC** = konkreter Anwendungsfall einer Band.

---

### 1. Navigation und Grundstruktur

**Drei Top-Level-Ansichten** (`lib/modes.ts`, `App.tsx`): `Live` (Dashboard), `Bibliothek`, `System`. Der Modus ist reiner React-State in `App` (nicht persistiert) – nach einem Reload startet die App immer in **Live**.

**Umschalten:** Ein einziger Menü-Button unten rechts (`☰ <Modus>`, mit kleinem Sync-Punkt: grün = synchron, blau pulsierend = synchronisiert, grau = offline, rot = Fehler). Er öffnet das `AppMenu` (Modal). Der Button ist **ausgeblendet**, solange das Dashboard im Bearbeitungsmodus ist (er läge sonst auf Resize-Griffen) und während der drei Onboarding-Screens.

**Zwei Layout-Bahnen** (Eingabe-Fähigkeit, `useInputCapability`, `useIsPanelLayout`):
- **Touch/schmal:** `System` zeigt eine horizontale Tab-Leiste; `Bibliothek` zeigt „Liste → Auswahl → Detail" als Einzelfokus mit Zurück-Weg; der Song-Editor nutzt auf dem Handy Tabs, auf Tablet-Hochkant ein Bottom-Sheet.
- **Maus/Tastatur oder breit (≥1024 px, oder Querformat ab 768 px):** `System` bekommt eine **Sidebar** (#179), `Bibliothek` zeigt zwei Spalten (Liste | Detail), der Song-Editor zwei Spalten (Text | Details). Bibliothek hat dann Pfeiltasten-Navigation (↑/↓/Enter) und Strg/Cmd+F für die Suche.

**Screens vor dem normalen Betrieb (Gates in `App.tsx`, Reihenfolge):**
1. `DeviceRevokedScreen` – wenn dieses Gerät im Geräte-Ledger „entfernt" wurde (Vorrang vor allem anderen).
2. `JoinBandView` – wenn das Gerät **noch gar keine Band** hat.
3. `RosterSetupView` – nur für das **gründende** Admin-Gerät (`Workspace.ownProfileId` gesetzt), solange die Roster-Einrichtung nicht abgeschlossen ist.
4. `ProfileRolePickerView` – wenn für die aktive Band noch nie ein Profil gewählt wurde (`undefined`; „ohne Profil" ist ein eigener Zustand `''`).

**Globale Overlays** (immer eingehängt, unabhängig vom Tab): `DialogHost` (ersetzt `window.prompt/confirm/alert`), `DiscoveryBanner`, `AudioResumeOverlay`.

**Immer laufende Treiber** (Hooks in `App.tsx`, unabhängig vom sichtbaren Tab): Audio-Ausgabe, Click-Ausgabe, Auto-Stopp/Übergänge, Clock-Sync, Cue-Scheduler, Hardware-Erkennung, Discovery-Trigger, Präsenz-Meldung, Geräteinfo-Meldung, Show-Log-Tracker, Wake-Lock, Vollbild beim Start, Audio-Sync-Abgleich.

---

### 2. Mehrere Bands, Konten, Rollen (so wie tatsächlich implementiert)

#### Workspaces (= Bands)
- Ein Gerät kann **mehrere Bands** kennen (`useWorkspaceStore`, persistiert in `localStorage` unter `stageboard-workspaces`). Jede Band hat eine **eigene lokale PouchDB** (`workspaceDb`); genau **ein** Live-Sync PouchDB↔CouchDB läuft für die aktive Band (`startWorkspaceSync`).
- **Lokal gegründete Band ohne Server** ist ein legitimer Dauerzustand (kein Passwort, kein Sync). „Verbinden" (Band-Tab) provisioniert sie später gegen einen Stage-Server.
- Bandname wird bei Umbenennung durch einen Admin über ein `workspace:access`-Dokument an alle Geräte repliziert (`initNameSync`).

#### Konten und Beitritt (WLAN-Modell)
- Pro Band gibt es einen **stehenden Zugangscode** (nie ablaufend, vom Stage-Server geführt). Bandliste ist ohne Code sichtbar (wie SSIDs); Roster/Beitritt erst mit Code.
- **Pro Roster-Mitglied und pro Gerät** ein eigener CouchDB-Account (`stageboard-<band>-<profil>~<gerät>`).
- **Nicht-Admins haben kein Passwort/PIN:** Antippen genügt. **Admins** brauchen einen 4-stelligen Code: die eigene PIN **oder** den universellen Recovery-Code (= letzte 4 Ziffern des Band-Zugangscodes). Bewusster Kompromiss laut Code-Kommentar: wer den Bandcode kennt, kann Admin werden. PIN-Fehlversuche werden serverseitig temporär gesperrt (429, UI-Meldung in Minuten).
- `Workspace.isAdmin` ist **nur eine UI-Weiche**; die echte Durchsetzung liegt laut Kommentar in CouchDB-Validierung (`_design/roster`) und in Server-Prüfungen.

#### Rollen
- `STAGE_ROLES = performer | lighttech | soundtech | crew | admin` (mehrere pro Profil möglich). `admin` ist eine Rolle in derselben Liste (Roster-Label + UI-Gate).
- Rollen steuern **nur Sichtbarkeit/Relevanz**: Widget-Bibliothek (`relevantRoles`) und private Dashboards („Stations"). Das ist ausdrücklich **client-seitig, keine Zugriffskontrolle** (Kommentar in `dashboard.ts`).
- Das aktive Profil pro Gerät/Band ist eine **lokale Wahl** (`useActiveProfileStore`, `localStorage`) und keine Authentifizierung im Sinne von Login – ausgenommen der Wechsel auf ein Admin-Profil, der die PIN prüft.

#### Master-Token (Gig-Modus)
- Ein Gerät hält den Master-Token (`ShowState.masterHolderId`); nur der Master schreibt Queue/Transport in den geteilten ShowState (`applyPatch`, `setActiveSetlist` prüfen `isMaster`).
- **„Übernehmen" ist ungeschützt** (kein PIN, keine Rolle) – bewusst als „Take Over" nach abgestürztem Master. Force-Override/Heartbeat (#32) ist **nicht** implementiert (offenes Issue).

---

### 3. Onboarding-Screens

#### 3.1 JoinBandView – Band beitreten / gründen (`components/JoinBandView.tsx`)
- **Was:** WLAN-artiger 3-Schritt-Ablauf: (1) verfügbare Bands des konfigurierten Stage-Servers listen (ohne Code) oder QR scannen, (2) Bandcode eingeben, (3) „Wer bist du?" aus dem Roster wählen (`fetchRoster` → `joinAsMember`). Zusätzlich: „Neue Band gründen", „Andere Band oder anderer Code", „Passwort direkt eingeben" (Workspace-ID + Benutzername + Passwort/PIN für Sonderfälle).
- **Wo:** Vollbild beim allerersten Start; freiwillig erneut aus dem Band-Tab („+ Band → Bestehender Band beitreten"), dann mit „Abbrechen".
- **Gating:** offen; Admin-Zeile verlangt 4-stellige PIN/Recovery-Code. QR-Scan braucht HTTPS/Kamera (sonst freundliche Meldung, Fallback Liste).
- **UC:** Neuer Schlagzeuger bekommt das Tablet, scannt den QR-Code vom Probenraum-Ausdruck und tippt seinen Namen – sofort sind Songs/Setlists da. **UC:** Nach Server-Tausch: Band aus der Liste wählen, Code eingeben, Admin-PIN.

#### 3.2 RosterSetupView – Roster aufbauen (`components/RosterSetupView.tsx`)
- **Was:** Nur beim gründenden Admin-Gerät, dreiphasig: **founder** (eigener Name + Pflicht-PIN, setzt `setOwnPin`, markiert das eigene Profil als aktiv) → **Mitglieder hinzufügen** (Name, Entfernen) → **Einladen-Screen** (`InviteBandView` mit Code/QR). „Bandnamen falsch eingegeben? Neu anfangen" löscht die Remote-Band – **nur** solange noch keine Profile existieren (Schutz nach dem S.O.A.T.-Vorfall).
- **Gating:** nur `foundedHere` + Admin; ein wiederherstellender Admin sieht das nie.
- **UC:** Bandleader gründet „Die Kellerkinder", legt sich, Bass, Drums und Sängerin an und druckt den Zugangscode für die Probe.

#### 3.3 ProfileRolePickerView – Profil wählen (`components/ProfileRolePickerView.tsx`)
- **Was:** Kachelraster der Roster-Namen; „Ohne Profil fortfahren" ist möglich (`''`). Hinweis wenn Roster leer.
- **UC:** Vertretungs-Gitarrist wählt „Gast" – sieht die gemeinsamen Dashboards, aber keine privaten Stations anderer.

#### 3.4 DeviceRevokedScreen / BackToWorkingBandLink
- **DeviceRevokedScreen:** Vollbild-Sperre „Dieses Gerät wurde entfernt", **kooperativ, kein Sicherheitsmechanismus** (kein Credential-Entzug; Wiederherstellen im Ledger hebt es sofort auf).
- **BackToWorkingBandLink:** Notausgang in den Onboarding-Screens: listet andere Bands mit gespeicherten Zugangsdaten. Bewusst nicht im freiwilligen Beitritts-Fall verwendet.

---

### 4. Live-Ansicht: Dashboard (`Dashboard.tsx`, `WidgetFrame.tsx`, `DashboardEditBar.tsx`, `DashboardManager.tsx`, `WidgetLibrary.tsx`, `EditLock.tsx`)

#### 4.1 Dashboard-Raster
- **Was:** `react-grid-layout`-Raster, Breakpoints `xl 1600 / lg 1024 / md 640 / sm 0` (Layout wird pro Breakpoint gespeichert, Breite wird real gemessen). Im Normalbetrieb **schreibgeschützt**: nichts bewegt sich. Sichtbare Dashboards = geteilte + eigene private Stations (`isDashboardVisible`). Fällt das gemerkte Dashboard weg, wird das erste sichtbare gezeigt. Unbekannte Widget-Typen (nach Update entfernt) erscheinen als „Unbekanntes Widget" mit Entfernen-Möglichkeit. Widgets, deren Hardware nicht erreichbar ist, bleiben **an Ort und Stelle, grau, inert, mit „⃠ Offline"** (Graceful Degradation).
- **Seed:** Zwei Standard-Dashboards mit festen IDs (`default-prompter`, `default-monitoring`), damit gleichzeitiges Seeden mehrerer Tablets nicht dupliziert.
- **UC:** Sängerin hat ein „Prompter"-Dashboard mit Lyrics und Queue; Techniker ein „Monitoring"-Dashboard – beide auf ihrem eigenen Tablet.

#### 4.2 Edit-Lock / Bearbeitungsmodus
- **Was:** `EditLock` im Menü (nur in Live): 600 ms **Langdruck** auf „Bearbeiten 🔒" entsperrt. Beenden per „🔒 Fertig" in der Edit-Leiste. Zustand wird **nicht persistiert** – nach Reload ist wieder alles gesperrt.
- **Gating:** rein UX-Schutz gegen Fehlbedienung, keine Rolle/PIN.
- **UC:** Bühne, Tablet im Ständer: ein versehentliches Tippen verschiebt nichts; erst der bewusste Langdruck im Menü erlaubt Umbauten.

#### 4.3 Edit-Leiste (`DashboardEditBar`)
- **+ Widget** öffnet die Widget-Bibliothek. **Dashboards verwalten** öffnet den `DashboardManager`. **Zurücksetzen** (Bestätigung, rot) verwirft **alle** Dashboards und legt die Standard-Layouts neu an. **🔒 Fertig** beendet den Modus.

#### 4.4 Widget-Rahmen (`WidgetFrame`)
- Im Edit-Modus ist der ganze Widget-Körper Ziehgriff, der Inhalt inert. **⋯-Menü** (auch per Doppelklick): Widget-eigene Konfiguration (ConfigPanel), **Rahmen ein-/ausblenden** („frameless", nur in der gesperrten Ansicht wirksam), **Entfernen** (rot, bewusst abgesetzt, ohne zweite Bestätigung).
- Rubber-Band-Kollisionslogik beim Ziehen/Skalieren (`resolveInteraction`), alle 8 Resize-Griffe.
- **UC:** Ein Trenner-Widget wird rahmenlos, damit das Dashboard aufgeräumt wirkt.

#### 4.5 Widget-Bibliothek (`WidgetLibrary`)
- **Was:** Overlay „+ Widget": Suche (Titel/Beschreibung) + Kategorien *Performance, Monitoring, Show Control, System & Crew, Utility, Nach der Show*. Angeboten wird nur, was zu den **installierten Plugins/Capabilities** und zu den **Stage-Rollen** des aktiven Profils passt (`availableWidgets`); fehlende Hardware blendet Widgets nicht aus, sondern graut sie im Dashboard aus. Mini-Live-Vorschau je Kachel mit Fehlergrenze (`WidgetPreviewErrorBoundary`).
- **Gating:** Edit-Modus.
- **UC:** Eine Band ohne Lichtplugin sieht keine Licht-Widgets – die Bibliothek bleibt übersichtlich.

#### 4.6 Dashboards verwalten (`DashboardManager`)
- **Was:** Liste „Meine Stations" + „Geteilt": ▲/▼ umordnen, Inline-Umbenennen, **Anzeigen**, **Duplizieren** (`<Name> Kopie`), **Löschen** (das **letzte öffentliche** Dashboard ist gesperrt); **+ Neu** mit Besitzer: *Geteilt*, *<Profil> (privat)* oder *Rolle: <Rolle> (privat)*.
- **Gating:** Edit-Modus; Privatheit ist **nur Anzeigefilter** (Dokument repliziert trotzdem zu jedem Gerät).
- **UC:** Der Tontechniker legt ein privates „FOH"-Dashboard für die Rolle *soundtech* an, das sonst niemand sieht.

#### 4.7 Dashboard-Auswahl im Menü
- `AppMenu` zeigt den Abschnitt **Dashboards** nur bei >1 sichtbarem Dashboard; Wahl wechselt direkt nach Live (`useActiveDashboardStore`, pro Gerät+Band gemerkt).

---

### 5. Hauptmenü (`AppMenu.tsx`) – alles, was im Betrieb gebraucht wird

| Abschnitt | Funktion | Gating / Hinweis |
|---|---|---|
| **Ansicht** | Live / Bibliothek / System | offen |
| **Dashboards** | Aktives Dashboard wählen | nur bei >1 sichtbarem |
| **Modus** (`SessionModeControl`) | **Gig** ↔ **Solo Üben**. In Solo läuft die Queue rein lokal, Wiedergabe über das eigene Gerät. Wechsel **Solo → Gig** stoppt lokales Playback und setzt es zurück (#233); **Gig → Solo** ist gesperrt, solange die geteilte Show spielt („Wechsel zu Solo Üben erst möglich, wenn gerade kein Song läuft"). | nur pro Gerät; Sperre = Sicherheitsfeature |
| **Setlist zum Üben** (`PracticeSetlistPicker`) | Nur im Solo-Modus: „Keine Setlist (ganzer Katalog)" oder eine bestehende Setlist. Wechsel stoppt Wiedergabe und setzt Position/Overrides zurück (#234). | lokal, berührt nie den ShowState |
| **Master-Kontrolle** (`MasterControl`) | Zeigt, wer Master ist; „Übernehmen"; zeigt die aktive Setlist. | nur im Gig-Modus; Übernehmen ungeschützt |
| **Dashboard** (`EditLock`) | Langdruck „Bearbeiten 🔒" | nur in Live |
| **Anzeige** | Vollbild an/aus | nur wenn Browser es unterstützt |

- **UC (Solo):** Gitarrist übt zu Hause die Setlist der nächsten Show mit Klick und Backing-Track, ohne dass die Band-Show-Uhr berührt wird. **UC (Gig):** Beim Stagewechsel „Übernehmen", damit das Tablet des Bandleaders die Queue steuert.

---

### 6. Bibliothek (`LibraryView.tsx`, `SetlistDetail.tsx`, `SongPreview.tsx`, `SheetEditor.tsx` + Editor-Bausteine)

#### 6.1 Bibliothek-Liste (`LibraryView`)
- **Suche** (Titel/Artist, Setlist-Namen), Filter **Alle | Setlists | Songs**, Setlists nach Erstelldatum absteigend, Songs alphabetisch.
- **+ Neu (Setlist):** Name per In-App-Dialog; öffnet die Setlist. **+ Neu (Song):** Titel per Dialog; legt Song mit Defaults (120 BPM, 4/4, leer) an und springt in den Editor.
- **Song-Zeile:** Tippen = Vorschau (nochmal tippen schließt). **Touch:** Wischen nach rechts (≥90 px) fügt zur **aktiven Setlist** hinzu (Hintergrund „+ Zur aktiven Setlist"). **Maus:** „+"-Button, **Rechtsklick**-Kontextmenü, Zeilen-⋯. Menüpunkte: *Zur aktiven Setlist hinzufügen* (deaktiviert ohne aktive Setlist), *Duplizieren* (Dialog, nur Maus), *Offline anheften / Offline-Pin entfernen*, *Löschen* (mit Bestätigung).
- **Drag & Drop (Touch):** Song auf die geöffnete Setlist-Spalte ziehen fügt dort ein (im Zwei-Spalten-Layout).
- **Tastatur (Maus-Bahn):** ↑/↓ Fokusring, Enter öffnet, Strg/Cmd+F fokussiert die Suche; inaktiv solange ein Dialog offen ist.
- **UC:** Beim Soundcheck fällt ein Song raus – Setlist öffnen, Song entfernen; ein Ersatzsong per Wischen in die aktive Setlist.
- **Gating:** keine (jeder mit Zugriff auf die Band; Datenschutz nur über Bandzugehörigkeit).

#### 6.2 Setlist-Detail (`SetlistDetail`)
- **Kopf:** Name, Badge **„● Aktiv"**, **Aktivieren** (setzt die geteilte aktive Setlist; **nur Master**, sonst deaktiviert), ⋯-Menü: **Umbenennen, Duplizieren („(Kopie)"), Löschen** (Bestätigung; löscht eine aktive Setlist → zuerst als Master deaktiviert). **„Setlist deaktivieren (alle Songs)"** (nur Master).
- **Einträge:** Ziehgriff ⠿ zum Umsortieren (Drag), Titel-Klick öffnet den Song, **Variantenwahl** (Portal-Dialog, weil ein `<select>` im scrollenden Container abgeschnitten wurde), ⋯ **Entfernen**. Derselbe Song darf **mehrfach** vorkommen (z. B. Vollversion + Kurzfassung als Zugabe).
- **Song hinzufügen:** durchsuchbare Combobox (Tippen filtert, Esc/Klick außerhalb schließt).
- **Übergangstyp pro Eintrag** (#232, neu): „→"-Button in jeder Zeile außer der letzten öffnet einen Dialog mit **Manuell** (Standard, stoppt am Ende), **Nächster bereit** (stoppt, stellt den nächsten Song bereit), **Nahtlos** (nächster Song startet sofort ohne Einzähler; Track wird vorgeladen), **Mit Pause** (Pause in Sekunden, dann Start mit Einzähler). Fortgeschrittenes Detail: Bar-Extend (#231) verschiebt den Übergangspunkt.
- **UC:** Ballade → Rocknummer als Segue: erster Eintrag „Nahtlos". **UC:** Ansage-Pause zwischen zwei Songs: „Mit Pause 10 s".
- **Grenzen:** Übergänge funktionieren, wo dieses Gerät die Audio-Ausgabe lokal übernimmt; Server-Audio-Plugins werden nicht vorgeladen. Ob bei „Mit Pause" im **Gig**-Modus ein Einzähler folgt, ist nicht abschließend verifiziert. Crossfade fehlt bewusst (#244).

#### 6.3 Song-Vorschau (`SongPreview`)
- Read-only Ansicht des Songs (ChordPro-Rendering), Button **Bearbeiten** öffnet den Editor.

#### 6.4 Song-Editor (`SheetEditor`)
- **Kopf (immer sichtbar):** ← Bibliothek, **Variante** (Auswahl + „+ Neue Variante"; bei nicht-Standard-Variante Feld „Varianten-Name"), **Titel**, **Band** (Artist), **Key, Tuning, Capo**. **Speichern** speichert Song + Variante (Fehlermeldung, „Gespeichert.").
- **Abschnitte** (alle initial eingeklappt; Phone = Tabs, Tablet-Hochkant = Bottom-Sheet, breit = Akkordeon neben dem Text):
  - **Text:** ChordPro-Textfeld mit Part-Buttons (**+ Verse/Chorus/Bridge …**, `PART_LABELS`) und **+ Kommentar**; **Song importieren**; **Tap-to-Sync starten**; Live-Vorschau (`ChordProLyrics`).
  - **Tempo & Klick:** BPM, Takt, „Klick standardmäßig an (per Show überstimmbar)", **Count-in** (aktiv + Takte), darunter das **Klick-Sync-Werkzeug:** Anker per Tippen setzen (`TapBeatAnchors`), **Track analysieren** (Plugin *music-tempo* falls installiert, sonst eingebauter Detektor; überschreibt vorhandene Anker nur nach Bestätigung), **Tempo-Wechsel** markieren (`TapTempoMarker`) und **erkennen**, Listeneditoren für **Klick-Anker** (Zeit, Beat-in-Bar) und **Tempo-Wechsel** (Zeit, BPM). Automatisch Erkanntes ist immer nur ein **Vorschlag zum Prüfen**.
  - **Audio:** `TrackManagerField` – benannte Tracks (*reference / band-mix / stem*) hochladen/entfernen; erst nach Speichern der Variante möglich („Erst speichern, dann Tracks anhängen.").
  - **Cues:** `CueListEditor` – Cue hinzufügen mit Zeit (s), Capability, Typ, **Ziel-Gerät** (nur Logical Devices mit dieser Capability), Payload als JSON; kein pluginspezifisches Autoren-Panel (später).
  - **Kommentare:** `CommentListEditor` – listet `{comment:}/{c:}/{cc:}`-Direktiven; **„Sichtbar für"** pro Kommentar (an bestimmte Mitglieder), Text ändern, entfernen. Die Position bleibt die Zeile im Text.
- **Song importieren** (`TabImportOverlay`): Suche → Vorschau → Übernahme von Akkorden/BPM/Key/Tuning/Capo/Band; „Original ansehen ↗" öffnet die Quelle in einem Popup (iframe scheitert an `frame-ancestors`). MusicBrainz-Treffer dienen nur der Identität, importierbar sind nur Treffer mit ChordPro-Inhalt. Nutzt Lookup-Plugins am Stage-Server (nicht verifiziert, ob ohne Server nutzbar).
- **Tap-to-Sync** (`TapToSync`): Zeile für Zeile im Takt tippen (Leertaste/Button); mit Track läuft die Master-Clock an der echten Wiedergabeposition, ohne Track als Stoppuhr → Zeitstempel `[mm:ss.xx]` im Text.
- **Gating:** keine. **UC:** Nach dem Import einer Tab-Vorlage legt der Gitarrist den Backing-Track an, lässt die Beat-Erkennung laufen, korrigiert zwei Anker von Hand und speichert; danach spielt der Klick sauber zum Track.

---

### 7. System-Ansicht (`SystemView.tsx`) – sieben Tabs

Tabs (Sidebar bzw. Leiste): **Band, Plugins, Hardware, Geräte, Backup\*, Nachbericht, Einstellungen** (\* nur sichtbar, wenn eine Backup-Capability installiert ist). Der aktive Tab wird in `useActiveSystemTabStore` veröffentlicht – die Hardware-Hot-Plug-Abfrage darf nur feuern, wenn „System → Hardware" tatsächlich offen ist.

#### 7.1 Band (`BandManagementView`)
- **Serverstatus-Zeile:** „Hardware auf diesem Server aktiv für: <Band>" / „Keine Band-Hardware aktiv" / „nicht erreichbar" / „antwortet langsam".
- **Bands:** Namen antippen = aktive Band wechseln. Zeilenmenü: **Umbenennen** (Admin), **Einladen** (Admin, nur serververbundene Band → `InviteBandView`), **Von diesem Gerät entfernen** (jedes Mitglied; löscht nur lokale Daten, Server unberührt), **Löschen** (Admin, rot, „endgültig", für alle Geräte). **+ Band** → *Bestehender Band beitreten* / *Neue Band gründen*. **Verbinden** verbindet eine lokal gegründete Band mit einem Server.
- **Roster:** Profil antippen = auf dieses Profil wechseln (lokale Band: sofort; serververbunden: Nicht-Admin sofort, Admin nach PIN-Eingabe). Zeilenmenü: **Meinen PIN setzen** (nur eigenes Admin-Profil), **Umbenennen**, **Stage-Rollen anpassen** (Checkboxen), **Passwort/PIN zurücksetzen** (anderer Admin; zeigt neuen 4-stelligen PIN), **Löschen** (mindestens **ein Admin muss bleiben**). **+ Neues Mitglied** (Admin). Nicht-Admins sehen „Nur der Band-Admin kann Mitglieder verwalten.". **Präsenzpunkte** je Mitglied (SSE-Präsenz, wie viele Geräte).
- **UC:** Der Bassist verlässt die Band – Admin löscht sein Profil. **UC:** Bandleader vergisst seine PIN – ein zweiter Admin setzt sie zurück.

#### 7.2 InviteBandView – „Einladen"
- Zeigt den stehenden Zugangscode + **QR** (Band + Code gemeinsam); **Code ändern** (`rotateAccessCode`, bewusst, z. B. nach Leak); **Drucken / als PDF speichern** (Browser-Druck, versteckt alles außer QR/Code). Wird auch als Abschluss des Gründungs-Wizards genutzt.

#### 7.3 Plugins (`PluginManager`)
- **Installiert:** Name/Version, Capabilities, **Health** (`läuft auf dem Tablet` / `online` / `Heartbeat veraltet` / `kein Heartbeat — Stage-Server offline?`), **Aktiv/Deaktiviert**-Schalter (deaktivierte Plugins verschwinden aus der Widget-Bibliothek), **Entfernen**. **Verfügbar:** Installieren aus dem **statischen, eingebauten Katalog** (`lib/pluginCatalog.ts`): mock-mixer, generic-webmidi, kemper-profiler, cq18t-mixer, nux-mg30, boss-rc500, soundcraft-ui24r, mock-lighting, mock-backup, mock-playback, music-tempo-beat-detection, mock-click.
- Installationen sind Dokumente, die zu allen Tablets und zum Stage-Server replizieren.
- **Gating:** keins in der UI (nicht admin-beschränkt gefunden). **Stub-Hinweis:** kein Plugin-Repository; mehrere Katalogeinträge sind `mock-*`.
- **UC:** Vor dem ersten Gig „Kemper Profiler" installieren, damit Preset-Cues ausgelöst werden können.

#### 7.4 Hardware (`HardwareSetupManager`, `DeviceSetupWizard`, `WorkspaceHardwareSettings` steht unter Einstellungen)
- **Was:** Liste aller **Logical Devices** (Rollen wie „Marcos Kemper") mit **Einrichten** und **Entfernen**, **+ Neues Gerät**. Der **Wizard** (Home-Assistant-Stil, 4 Schritte): 1 Name (mit Liste bestehender Geräte, gegen Kollisionen), 2 Gerätetyp (installiert das passende Katalog-Plugin inline), 3 Verbindung (**Auto-Erkennung** über die Discovery-Session der ganzen Band, gefiltert auf das gewählte Plugin und beschriftet, wer es gemeldet hat — oder **manuell**: Ausführungsziel Server/Tablet + Transportfelder), 4 Verifizieren (**Testen** / **Speichern** / **Fertig**). „Einrichten" springt direkt zu Schritt 3.
- **Hot-Plug:** Wird ein unbekanntes MIDI-Gerät erkannt, kann `useHardwareDetection` den Wizard vorbefüllen öffnen (nur wenn dieser Tab offen ist).
- **Discovery-Banner:** Bei Mehrdeutigkeit fordert ein oben eingeblendetes Banner („Geräte-Erkennung — <Gerät>: <Anweisung>") dazu auf, das Gerät physisch zu bedienen; blockiert die UI nicht.
- **Gating:** in der UI keine Rolle geprüft (nicht verifiziert im Hintergrund). Nur *dieses* Gerät kann seine eigene Transport-Verdrahtung bearbeiten (Browser sieht nur eigene USB/MIDI-Ports).
- **UC:** Der Gitarrist steckt seinen Kemper per USB ein → Prompt „Neues Gerät: Kemper – welche Rolle?" → Wizard → Testen → Cues am Song zielen auf „Marcos Kemper".

#### 7.5 Geräte (`DeviceLedgerView`)
- **Geräte-Ledger:** jedes Gerät, das der Band je beigetreten ist; je Zeile Name, Hostname/OS/IP, Umgebung, Sync-Status, **„App offen"** (frische Geräte-Meldung) und **„Netzwerk erreichbar"** (echter ICMP-Ping des Stage-Servers), „Zuletzt gesehen". Oben: Stage-Server (LAN-IP). **Admin:** **Entfernen/Wiederherstellen** eines Geräts (Bestätigung; Server prüft Admin; 403 → Dialog). Geräte-Diagnose wird nur **gepollt, solange dieser Tab offen ist** (SSE-Connection-Budget des Browsers).
- **UC:** Ein Tablet hört mitten im Soundcheck auf zu reagieren: im Ledger sieht man „Netzwerk erreichbar ✔, App offen ✘" → App wurde geschlossen, nicht das WLAN ausgefallen.

#### 7.6 Backup (`BackupManager`)
- **Backup-Plugins:** nur Statusanzeige (Name, Health, Aktiv) – StageBoard löst selbst keine Backups aus. **Lokale Snapshots** (unabhängig vom Plugin, *real*): **Backup herunterladen** (JSON-Dump von Songs, Setlists, Dashboards, Profilen, Plugins, Show-Log) und **Backup wiederherstellen…** (Datei wählen, Bestätigung, wird mit lokalen Daten **zusammengeführt**).
- **Gating:** Tab nur mit Backup-Capability sichtbar; Snapshot-Funktionen offen. **Stub-Hinweis:** der Katalog kennt nur `mock-backup`.
- **UC:** Vor der Tour: Snapshot ziehen und auf den USB-Stick kopieren.

#### 7.7 Nachbericht (`PostShowReport`)
- **Was:** Shows aus dem replizierten Show-Log (gruppiert nach `showId`, neueste zuerst): gespielte Songs (mit Uhrzeit und aktiver Dauer, Zählung ab **20 s** aktiv), technische Ereignisse (`capability-changed`, Warnungen orange) und **Notizen** von Band/Crew (mit Autor). Rein lesend.
- **UC:** Am Tag danach: welche Songs liefen wirklich, wann fiel das Licht-Gerät aus.

#### 7.8 Einstellungen (`SystemSettings`)
Alles einmalig einzustellen, pro Gerät:
- **Gerätename** (`DeviceNameSettings`, selbst umbenennen; erscheint überall, z. B. Master-Anzeige).
- **Darstellung** (`ThemeSwitcher`): 5 Designs *Klassisch, Stage Console, Soft Cards, High Contrast, Neon Live*; Hell/Dunkel nur bei „Klassisch" (die anderen sind dunkel). `localStorage`.
- **Textgröße** (`TextSizeSettings`): Standard-Schriftgröße für Prompter, Live-Queue, Show-Notizen, System-Status; pro Widget im ⋯-Menü überschreibbar.
- **Stage-Server** (`StageServerSettings`): Serveradresse zur Laufzeit ändern (`useStageServerStore`, persistiert), für Fehlersuche und für solo gegründete Bands.
- **Aktive Band (Hardware)** (`WorkspaceHardwareSettings` + `SwitchServerBandWizard`): welche Band die Hardware **dieses** Stage-Servers bedient (immer nur eine). **Band wechseln…** = abbrechbarer Wizard: (1) PIN des Admins der aktuell aktiven Band (Name wird nicht gefragt, wenn das eigene Profil Admin ist; sonst Admin aus der vom Server gelieferten Liste), (2) Zielband, (3) Bandcode falls dieses Gerät sie nie gecacht hat, (4) Ziel-Admin, (5) PIN; erst dann committet der Server beide Nachweise. Danach folgt dieses Gerät dem Wechsel.
- **Synchronisation** (`SyncIndicator`): Status über alle Streams (mit Prozentanzeige, wenn CouchDB Fortschritt meldet). Bei `error` (401/403 beendet die PouchDB-Replikation endgültig): Schaltfläche **Reparieren** (Zugangscode eingeben → `joinAsMember` erneuert Credentials in-place).
- **Speicher & Sync** (`AudioSyncSettings`): Audio-Cache-Strategie für die aktive Band: **Keine / Selektiv / Komplett** (Komplett wird gesperrt, wenn der Katalog nicht sicher in den Speicher passt), Quota-Anzeige. „Selektiv" cached aktive Setlist + manuell angeheftete Songs (Offline-Pin).
- **UC:** Schlagzeuger stellt „Selektiv" ein, damit nur die heutige Setlist und seine angehefteten Songs auf dem Tablet liegen.

---

### 8. Globale Bausteine

- **`DialogHost` + `useDialogStore`:** In-App-`promptText`, `promptFields`, `confirm`, `alert` (Promise-basiert). **Ersetzt native Browser-Dialoge** (Capacitor/PWA-Risiko, blockierendes JS, Optik).
- **`OverflowMenu` / `RowActionsMenu`:** wiederverwendbare ⋯-Menüs; destruktive Aktionen rot und abgesetzt (Distanz statt zweiter Bestätigung, Aufrufer bestätigen selbst); deaktivierte statt entfernte Einträge („warum nicht", nicht verschwinden lassen).
- **`AudioResumeOverlay`:** blockierendes Vollbild „Wiedergabe unterbrochen – Antippen zum Fortsetzen", wenn die Browser-Autoplay-Policy die automatische Wiedergabe nach Reload ablehnt (höchster z-Index der App).
- **`DiscoveryBanner`:** siehe 7.4.
- **`ChordProLyrics`:** Renderer (Abschnitts-Highlighting, Paginierung, Schriftgröße von Widgets steuerbar).

---

### 9. Zustands-Stores (`store/`) – was, wo gespeichert

**Legende Speicherort:** *PouchDB→CouchDB* = pro Band lokal in PouchDB, per Live-Sync repliziert; *localStorage* = pro Gerät (Zustand-`persist` bzw. direkt); *flüchtig* = nur Speicher; *Server-Stream* = SSE/Polling vom Stage-Server.

| Store | Inhalt | Speicherort |
|---|---|---|
| `useWorkspaceStore` (952 Z.) | Bandliste, aktive Band, Zugangsdaten (`couchPassword`, `username`), `isAdmin`, `ownProfileId`; alle Band-/Mitglieder-/Server-Aktionen (Gründen, Beitritt, PIN, Rename, Code rotieren, Hardware-Wechsel, Roster abrufen) | `localStorage` `stageboard-workspaces` + Server-Aufrufe |
| `useProfilesStore` | Roster (Profil = id, Name, `stageRoles`); Anlegen/Umbenennen/Rollen/Löschen/`connectToServer` | PouchDB→CouchDB |
| `useActiveProfileStore` | aktives Profil je Band (`''` = „ohne Profil") | `localStorage` |
| `useRosterSetupStore` | Roster-Einrichtung abgeschlossen (je Band, pro Gerät) | `localStorage` |
| `useSongsStore`, `useSongVariantsStore`, `useSetlistsStore` | Songkatalog, Varianten (Tracks, Anker, Tempo-Marker, Cues, Count-in), Setlists (Legacy-`songIds` werden lesend zu `entries` migriert; `transitionType`/`transitionDelayMs` optional) | PouchDB→CouchDB (Tracks als Attachments) |
| `useShowStateStore` | geteilter Live-Zustand: Master-Token, aktive Setlist/Eintrag, Transport, Click-Override, Extend | PouchDB→CouchDB |
| `usePracticeStateStore` | lokales Echo des Zustands für **Solo Üben** (je Band) | `localStorage` `stageboard-practice-state` |
| `useAppModeStore` | Gig ↔ Solo (pro Gerät, nicht pro Band) | `localStorage` `stageboard-app-mode` |
| `useShowLogStore` | Show-Log-Ereignisse; „aktuelle Show" wird daraus abgeleitet | PouchDB→CouchDB |
| `useDashboardsStore` | Dashboards (Widgets, Layouts je Breakpoint, Sichtbarkeit, Besitzer), CRUD, `resetToDefaults`, `resetNonce` | PouchDB→CouchDB |
| `useActiveDashboardStore` | welches Dashboard dieses Gerät zeigt (je Band) | `localStorage` |
| `useEditModeStore` | Edit-Lock | **flüchtig** (bewusst) |
| `usePluginsStore` | installierte Plugins + Health-Stream | PouchDB→CouchDB + Server-Stream |
| `useLogicalDevicesStore` | Logical Devices (Rollen mit Routing) | PouchDB→CouchDB |
| `useDeviceTransportConfigStore` | Transportverdrahtung je Gerät × Logical Device (`deviceId:logicalId`) | PouchDB→CouchDB |
| `useDevicesStore` | DeviceRegistry (Selbstregistrierung, Umbenennen, `revoked`) | PouchDB→CouchDB + Server-Aufruf für `revoke` |
| `useDeviceInfoStore` | Diagnose fürs Ledger (OS, IP, App offen, Ping) | Server-**Polling**, nur solange der Ledger offen ist |
| `usePresenceStore` | „Wer ist online, auf wie vielen Geräten" | Server-Stream (SSE) |
| `useDeviceTriggerListenerStore` | Trigger-Relay-Stream dieses Geräts → lokale Mock-Engines | Server-Stream (SSE) |
| `useDiscoverySessionStore` | Live-Discovery-Session der Band | Server-Stream (SSE) |
| `useHardwareSetupWizardStore` | Befehlskanal „Wizard vorbefüllt öffnen" | flüchtig |
| `useActiveSystemTabStore` | sichtbarer System-Tab (oder `null`) | flüchtig |
| `useLocalAudioOutputStore`, `useLocalMixerStore`, `useLocalLightingStore` | lokale Zustände, wenn **dieses** Gerät als Ausgabe/Mixer/Licht dient | flüchtig |
| `useClockStore`, `useClockSyncStore` | Show-/Master-Clock, NTP-artige Serverzeit-Korrektur | flüchtig |
| `useSyncStore` | Sync-Stream-Status/Fortschritt, Browser-Offline | flüchtig |
| `useAudioSyncStore`, `useAudioPinsStore` | Cache-Modus, angeheftete Songs (je Band) | `localStorage` |
| `useThemeStore` | Design + Hell/Dunkel | `localStorage` |
| `useContentFontSizeStore` | Standard-Textgröße | `localStorage` |
| `useViewportStore` | Vollbild-Präferenz | `localStorage` `stageboard-viewport` |
| `useStageServerStore` | Stage-Server-URL zur Laufzeit | `localStorage` `stageboard-stage-server` |
| `useDialogStore` | aktuelle Dialoganfrage | flüchtig |

---

### 10. Ehrlicher Stand: Stubs, Lücken, Vorsichtspunkte

- **Rollen und private Dashboards sind kein Zugriffsschutz** (nur Anzeigefilter; Dokumente replizieren zu allen). Bewusst dokumentiert im Code.
- **Master-Token „Übernehmen" ist ungeschützt** (kein Force-Override/Heartbeat, #32 offen). Jeder im Band kann die Show übernehmen.
- **Edit-Lock und Gerät-Entfernen sind kooperativ**, keine Sicherheitsgrenze (Geräte-Sperre entzieht keine Credentials).
- **Plugin-Katalog ist ein fest eingebauter Katalog** ohne Repository; mehrere Einträge (`mock-mixer`, `mock-lighting`, `mock-backup`, `mock-playback`, `mock-click`) sind Mock-Implementierungen. Echte Hardware-Plugins im Katalog: Kemper, Boss RC-500, NUX MG-30, CQ-18T, Soundcraft Ui24R, Generic WebMIDI (Reifegrad pro Plugin nicht geprüft).
- **Audioübergänge (#232):** nahtlos nur mit lokaler Audio-Ausgabe (Server-Plugin-Audio nicht vorgeladen); Live-Test auf Tablets steht aus; `delayed` im Gig-Modus: Einzähler nicht verifiziert; **Crossfade fehlt** (#244); Übergangsziel „Transition-Item" (#29) existiert noch nicht.
- **Auto-Stopp/Übergang** (#231/#232) funktioniert auf dem Gerät, das zugleich Master (`canControl`) **und** lokale Audio-Ausgabe ist; ist beides auf zwei Tablets verteilt, greift die Automatik nicht (im Code als Limitation dokumentiert).
- **Bekannte Build-Warnungen** (Vite): `practiceQueue.ts` und `useAppModeStore.ts` werden statisch **und** dynamisch importiert (kein Chunk-Splitting) – harmlos, Dynamic-Imports existieren wegen Test-Isolation.
- **Offene, zugehörige Issues** (Auswahl): #213 (Container/Group-Widgets Nesting), #183/#182 (Setlist/Song-Erstellungs-Flows), #149 (Multi-Instance-Hardware-Routing), #85/#84 (Master-Token-Modus, abweichender Stage-Server je Band), #70 (Break-Glass-CLI), #57/#16 (Rollenbasierter Zugriff, Read-only-Dashboards), #29/#28/#27/#26 (Show-Flow, Festival-Clock, Foot Switch, Stage Messenger).
- **Nicht in diesem Survey geprüft:** die konkreten Widgets, Server-Endpunkte/Plugins im Backend, die Wirksamkeit der serverseitigen Rechteprüfungen, Verhalten auf iOS/Capacitor.

---

## Teil C - Backend, Datenmodell, Plugins, Domain-Logik

Stand: 2026-09-19, `main` @ `e265c88` (nach Merge von #242/#243/#245).
Quelle: direkt aus dem Code gelesen (`packages/core-backend/src`, `packages/shared-types/src`, `packages/stage-pwa/src/lib`), gegengelesen mit `docs/00`, `02`, `05`, `08` und der offenen Issue-Liste.
Kennzeichnung: **[fertig]** = im Code verifiziert und verdrahtet, **[teilweise]** = vorhanden, aber mit klaren Lücken, **[Stub]** = Gerüst/Mock ohne echte Funktion, **[geplant]** = nur Issue/Doku, kein Code.
Nicht enthalten: Widgets/Screens (`stage-pwa/src/widgets`, `components`) – das deckt ein anderer Survey ab. Wo ein Widget zur Einordnung nötig ist, wird es nur erwähnt.

---

### 1. Systemüberblick

| Baustein | Was es ist | Zustand |
|---|---|---|
| **Stage-Server** (`core-backend`) | Ein Fastify-Prozess (HTTP/2 + TLS, wenn `certs/dev-cert.pem` existiert, sonst HTTP/1.1). Liefert die gebaute PWA aus, proxyt CouchDB unter `/db`, hält flüchtige Live-Stores (Presence, Health, Discovery, Relay), speichert Audio-Dateien, hostet Server-Plugins, provisioniert Bands/Konten. | läuft produktiv auf Marcos Rechner (`node dist/index.js`, Port 443) |
| **CouchDB** | Eine Datenbank pro Band (`stageboard-<workspaceId>`), alle Dokumentarten per `_id`-Präfix (`songs:`, `setlists:`, `profiles:`, `plugins:`, `logical-devices:`, `devices:` …). | fertig |
| **Tablet-Client** (`stage-pwa`) | React-PWA mit lokaler PouchDB pro Band, Live-Sync gegen CouchDB (über den `/db`-Proxy des Stage-Servers). Rechnet Uhr, Queue, Click, Cues **lokal**. | fertig |
| **shared-types** | Zod-Schemas + TypeScript-Typen für alles, was zwischen Server und Client fließt. | fertig |

**Wichtigste Architekturentscheidungen (verifiziert):**
- **Local-First:** Musik-/Setlist-Daten fließen *nur* über PouchDB↔CouchDB. Fastify sitzt nicht dazwischen (nur als Reverse-Proxy `/db`, der den Basic-Auth-Header des Clients unverändert durchreicht – `index.ts:1178`).
- **Ein Ursprung:** Server liefert PWA, API und DB unter einer Origin aus → ein einziges Zertifikat-Ausnahme-Tippen pro Tablet. Zusätzlich lauscht ein Port-80-Listener nur für den 301-Redirect auf HTTPS, und ein selbstgebauter mDNS-Responder antwortet auf `stageboard.local` (nur A-Record).
- **Zwei Sync-Wege:** *Dauerhafte* Daten → CouchDB-Replikation. *Flüchtige Live-Signale* (Präsenz, Plugin-Gesundheit, Geräte-Info, Discovery-Session, Geräte-Relay) → In-Memory-Stores im Server + SSE-Push. Diese gehen bei Serverneustart verloren (bewusst – sie werden von den Clients zyklisch neu gemeldet).
- **Zwei Ausführungsorte für Hardware:** Server-Plugin (Node, `IShowControlPlugin`) *oder* Client-Translator im Browser (WebMIDI/WebSocket). Welcher zuständig ist, entscheidet das Logical Device (`executionTarget`).

---

### 2. Endpunkt-Referenz (core-backend)

Alle Routen aus `index.ts`. **Auth** = Prüfung im Handler (nicht per Fastify-Hook). Es gibt *keine* globale Authentifizierung; das Modell ist „LAN + Band-Code“.

#### 2.1 Infrastruktur
| Methode/Pfad | Zweck | Auth |
|---|---|---|
| `GET /health` | Liveness `{status:'ok'}` | – |
| `GET /time` | `{serverTime: Date.now()}` – Ziel des Clock-Sync-Burst | – |
| `GET /server-info` | `{lanIp, hostname}` (für QR-Code „Band einladen“, frisch pro Aufruf ermittelt) | – |
| `ANY /db/*` | Reverse-Proxy auf CouchDB (`@fastify/http-proxy`), Client-Auth wird durchgereicht | CouchDB selbst |
| `GET /*` | statische PWA aus `packages/stage-pwa/dist` (falls vorhanden) | – |

#### 2.2 Audio-Speicher
| Methode/Pfad | Zweck | Auth |
|---|---|---|
| `PUT /audio/:variantId/:trackId` | Track-Datei hochladen (Body-Limit 200 MB, `MAX_AUDIO_UPLOAD_BYTES`) | **keine** |
| `GET /audio/:variantId/:trackId` | Track laden (`application/octet-stream`; Mime-Typ steckt in `TrackMeta`) | **keine** |
| `DELETE /audio/:variantId/:trackId` | Track löschen | **keine** |

IDs werden gegen `^[a-zA-Z0-9-]+$` geprüft (Path-Traversal-Schutz); Ablage `./data/audio/<variantId>/<trackId>`.

#### 2.3 Plugins & Lookup
| Methode/Pfad | Zweck | Auth |
|---|---|---|
| `GET /plugins` | Liste registrierter Server-Plugins `{name,version,capabilities}` | – |
| `GET /plugins/:id/client.js` | gecachtes Client-Bundle eines Plugins (Mirror) | – |
| `POST /plugins/:name/trigger` | `ShowControlEvent` an Server-Plugin; optional `scheduledAt` → Server wartet bis dahin (Gateway-Ahead-of-Time) | **keine** |
| `GET /lookup/:provider/search?q=` | Suche bei `ultimate-guitar-scraper` / `metadata-lookup` | – |
| `GET /lookup/:provider/detail?resultId=` | Detail/Import-Daten eines Treffers | – |
| `GET /plugin-health/:ws/stream` (SSE) · `POST /plugin-health/:ws/report` | Plugin-Erreichbarkeit pro Band (Snapshot bei Subscribe, dann Push) | – |

#### 2.4 Live-Signale pro Band (SSE = Server-Sent Events)
| Methode/Pfad | Zweck |
|---|---|
| `GET /workspaces/:ws/presence/stream` (SSE) · `POST …/presence/report` | Wer (Profil) ist auf welchem Gerät online |
| `GET /workspaces/:ws/device-info` · `POST …/device-info/report` | Geräte-Diagnose (IP, OS, Umgebung, Sync-Status, Ping-Erreichbarkeit, Hostname) – bewusst **Polling**, kein SSE (HTTP-Verbindungsbudget) |
| `POST /workspaces/:ws/devices/:deviceId/revoke` | Admin sperrt/entsperrt ein Gerät (weiches Kick: setzt `revoked` im Device-Dokument) – **Admin-Auth** |
| `GET /workspaces/:ws/devices/:deviceId/trigger-stream` (SSE) · `POST …/trigger` | Geräte-Relay: One-Shot-Event an *genau ein* Tablet |
| `GET …/discovery/stream` (SSE) · `POST …/discovery/{start,stop,candidates,triggered,assign}` | Discovery Mode (bandweite Hardware-Erkennung) |

#### 2.5 Band-/Konten-Verwaltung
| Methode/Pfad | Zweck | Auth |
|---|---|---|
| `GET /workspaces` | alle Bands dieses Servers (id+Name) – öffentlich wie WLAN-Namen | – |
| `POST /workspaces` | neues Band anlegen (DB, `_security`, Roster-Validator, Gründer-Konto) | – |
| `POST /workspaces/:ws/roster` | Mitgliederliste, nur mit Band-Code | Band-Code |
| `POST /workspaces/:ws/join/:profileId` | als Mitglied beitreten (Geräte-Konto ausstellen) | Band-Code (+ Admin-PIN bei Admin-Profil) |
| `POST …/members/:profileId/activate` | als anderes Profil im selben Band weiterarbeiten | Anrufer-Zugangsdaten |
| `POST …/members` · `…/members/:id/admin` · `DELETE …/members/:id` · `…/reset-password` | Mitglieder anlegen / Admin-Rolle / entfernen / PIN zurücksetzen (letzter Admin ist geschützt) | Admin |
| `POST …/members/:id/set-pin` | Admin setzt *eigenen* 4-stelligen PIN | eigenes Konto |
| `POST …/access-code` · `…/access-code/rotate` | Band-Code anzeigen / rotieren | Admin |
| `POST …/name` · `DELETE /workspaces/:ws` | Band umbenennen / unwiderruflich löschen | Admin |

#### 2.6 Hardware-Umschaltung (ein Server, mehrere Bands nacheinander)
| Methode/Pfad | Zweck | Auth |
|---|---|---|
| `POST /workspaces/:ws/verify-admin-pin` | „Ist dieser Admin+PIN gültig?“ (für Wizard-Schritt) | Admin-PIN, mit Sperre |
| `POST /workspaces/:ws/activate-hardware` | Server bedient ab jetzt dieses Band (Plugin-Sync + MIDI-Watcher) | Admin-PIN des *Ziel*-Bands **und** – falls ein anderes aktiv – Admin-PIN des *aktiven* Bands |
| `GET /server/active-workspace` · `GET /server/active-workspace/admins` | welches Band aktiv ist / dessen Admin-Namen (ohne Code) | – |

---

### 3. Backend-Fähigkeiten im Detail

#### 3.1 Band-/Konten-Provisionierung (`workspaceProvisioning.ts`, `couch.ts`) **[fertig]**
- **Was:** Legt pro Band eine CouchDB-Datenbank an, setzt `_security` und einen `_design/roster`-Validator (nur `admin`-Rolle darf `profiles:*` schreiben). Jedes Gerät bekommt ein *eigenes* CouchDB-Konto (`stageboard-<ws>-<profile>~<deviceId>`); pro Profil existiert zusätzlich ein „Anker“-Konto, dessen Passwort bei Admins der 4-stellige PIN ist.
- **Wie:** Der Server nutzt eigene CouchDB-Admin-Zugangsdaten (`COUCHDB_USER/PASSWORD`, Default `admin/admin`!). Nicht-Admins brauchen nie ein Passwort; Admins bestätigen mit eigenem PIN *oder* den letzten 4 Ziffern des Band-Codes (Notfall-Universalcode). Ein neues Tablet, das dasselbe Profil nutzt, rotiert nie das Passwort eines anderen Tablets.
- **Grenzen:** Kein Break-Glass-Skript, wenn *alle* Admins ausgesperrt sind (#70 offen). Ein Band mit anderem Server als die übrigen Bands des Geräts ist nicht unterstützt (#84). Master-Token-Modus (pro Gerät / pro Konto) nicht konfigurierbar (#85). Default-Zugangsdaten `admin/admin` sind Dev-Komfort – auf einem echten Server per Umgebungsvariable ändern.
- **Use Cases:** (1) Die Cover-Band „Nachtschicht“ gründet ihr Band im Proberaum: Sängerin legt das Band an, druckt den Band-Code aus, drei Mitmusiker tippen „Band beitreten“, wählen ihren Namen – kein Passwort. (2) Der Bassist hat sein Tablet verloren: Admin sperrt das Gerät im Device Ledger; das neue Tablet tritt mit dem Band-Code bei und bekommt ein frisches Konto, das alte Tablet bleibt ausgesperrt.

#### 3.2 PIN-Sperre (`pinThrottle.ts`) **[fertig]**
- **Was:** Nach 5 falschen Admin-PINs pro `workspace:profil` 5 Minuten Sperre (HTTP 429 + `Retry-After`). Max. 500 Einträge im Speicher, veraltete werden verdrängt.
- **Wie:** Gemeinsam genutzt von `verify-admin-pin` und `activate-hardware`, damit man nicht über zwei Routen doppelt so viele Versuche bekommt. Loggt die Sperre mit Client-IP.
- **Grenzen:** Nur in-memory (Serverneustart entsperrt). Andere PIN-prüfende Routen (`join`, `activate`) laufen *nicht* durch diese Sperre (in `index.ts` nur an den beiden Hardware-Routen verdrahtet).
- **Use Case:** Ein Fremder im Venue-WLAN rät den 4-stelligen PIN des Bandleiters – nach fünf Fehlversuchen ist Schluss, im Server-Log steht seine IP.

#### 3.3 Hardware-Controller / „welches Band bedient dieser Server“ (`workspaceHardwareController.ts`, `activeWorkspaceStateStore.ts`) **[fertig]**
- **Was:** Hält genau *ein* aktives Band. `activate(ws)` beendet zuerst das vorherige (Plugins deregistrieren, Sync und MIDI-Watcher stoppen) und startet dann Plugin-Sync + MIDI-Watcher für das neue. Die Wahl wird in `data/active-workspace.json` gespeichert und beim Start wiederhergestellt (Vorrang vor `STAGEBOARD_WORKSPACE`).
- **Wie:** Der Wechsel erfordert zwei Beweise (Admin des Ziels + Admin des laufenden Bands), damit niemand eine fremde Live-Show abwürgen kann.
- **Grenzen:** Ohne aktives Band ist `GET /plugins` leer (kein Fehler – das war der Vorfall vom 2026-09-10). Nur ein Band gleichzeitig (bewusst: „zwei Bands an unterschiedlichen Tagen“).
- **Use Case:** Marco spielt Samstag mit Band A, Sonntag mit Band B auf demselben Mini-PC: Er wechselt im Einstellungs-Wizard die aktive Band, die USB-MIDI-Geräte und Plugins folgen.

#### 3.4 Plugin-Sync & Registry (`plugins/pluginSync.ts`, `registry.ts`, `catalog.ts`, `healthStore.ts`, `pluginBundleStore.ts`) **[fertig für Mocks, teilweise insgesamt]**
- **Was:** Liest `plugins:*`-Dokumente des aktiven Bands aus CouchDB, vergleicht mit der Registry (`reconcile`) und registriert/deregistriert Server-Plugins. Hört auf den CouchDB-`_changes`-Feed (Long-Poll 30 s, Retry nach 5 s). Schreibt alle ~5 s (`HEALTH_TIMEOUT_MS/3` = 15 s/3) einen „online“-Herzschlag pro Plugin in den Health-Store. Lädt `clientSource`-Bundles einmal auf die Platte (`data/plugins/<id>/client.js`) und liefert sie als LAN-Mirror aus.
- **Wie:** Der Server kennt nur Implementierungen aus `PLUGIN_CATALOG` (`mock-mixer`, `mock-lighting`, `mock-playback`). Ein installiertes Plugin ohne Implementierung wird geloggt und als „unavailable“ ignoriert. Plugins mit `runtime: 'client'` werden serverseitig übersprungen.
- **Grenzen / ehrlich:** Die Server-Plugins sind **nur Mocks** (`mock-mixer` merkt sich Lautstärken, `mock-lighting` merkt sich den letzten Cue-Typ, `mock-playback` hält Play/Pause-Zustand – es wird *kein Ton* erzeugt). `mock-backup` und `mock-click` stehen im PWA-Katalog, haben aber **keine** Server-Implementierung → auf dem Server „unavailable“. Echter Server-Plugin-Code aus `source` nachladen (#17) ist **nicht gebaut**. Es gibt keinen echten Mixer-/DMX-Server-Adapter.
- **Use Cases:** (1) Ein Admin installiert im PWA das Plugin „Mock Playback“ – dank CouchDB-Replikation erscheint es binnen Sekunden im Server, ohne dass jemand den Server anfasst. (2) Fällt das Plugin aus (Herzschlag > 15 s alt), werden IEM-/Licht-Widgets grau statt zu verschwinden (Graceful Degradation).

#### 3.4b Audio-Speicher (`audioStore.ts`) **[fertig]**
- **Was:** Backing-Track-Dateien liegen auf der Server-Platte, nicht in CouchDB (sonst müsste jedes Tablet den ganzen Audio-Katalog replizieren).
- **Wie:** `writeAudioFile/readAudioFile/deleteAudioFile` unter `AUDIO_STORAGE_DIR` (Default `./data/audio`); Client-Seite: `audioClient.ts`.
- **Grenzen:** Keine Authentifizierung, keine Prüfsumme, keine Streaming-/Range-Requests (ganze Datei per GET), kein Quota-Management serverseitig.
- **Use Case:** Der Drummer lädt den Backing-Track „Wonderwall (ohne Schlagzeug)“ einmal im Proberaum hoch; alle Tablets ziehen ihn bei Bedarf.

#### 3.5 Lookup-Plugins (`ultimateGuitarPlugin.ts`, `ultimateGuitarFormat.ts`, `musicBrainzPlugin.ts`, `lookupRegistry.ts`) **[fertig, fragil]**
- **Was:** Zwei Nur-Lese-Datenquellen: *Ultimate Guitar* (Akkordtabs) und *MusicBrainz* (Titel/Künstler/Erscheinungsdatum). Beide starten immer (nicht bandinstalliert).
- **Wie (UG):** Headless Chrome via `puppeteer-core` (Chrome-Pfad per `CHROME_EXECUTABLE_PATH` oder Standardpfade), liest `window.UGAPP.store.page.data`, filtert „Pro/Official/Video“, wandelt UG-Markup (`[ch]G[/ch]` über der Textzeile) per `convertUltimateGuitarContent` in ChordPro (`[G]text`, `{part: Verse 1}`). Liefert zusätzlich Key, Tuning, Capo, BPM. **Wie (MB):** REST gegen `musicbrainz.org/ws/2`, `User-Agent` gesetzt, 10 Treffer.
- **Grenzen:** UG-Scraper hängt an UG-Seitenstruktur und einer lokal installierten Chrome (`--no-sandbox`); bei Änderungen bricht er. Robustheit (#15) offen. Kein Rate-Limit/Caching. MusicBrainz: keine Retries.
- **Use Cases:** (1) Gitarristin sucht „Wonderwall“, importiert die Tab mit Akkorden direkt in den Song-Editor. (2) Beim Anlegen „Nur ein Titel eingetippt“ ergänzt MusicBrainz den Künstler.

#### 3.6 Geräte-Relay (`deviceRelay.ts`) **[fertig]**
- **Was:** Ein Tablet schickt ein Ad-hoc-Event an *ein bestimmtes* anderes Tablet (Ziel: dessen Logical-Device-Bindung), Server leitet per SSE weiter.
- **Wie:** In-Memory-Map `workspace:device → Subscriber`. `POST …/trigger` antwortet `{status:'error',message:'Zielgerät nicht verbunden'}` (HTTP 200), falls niemand lauscht.
- **Grenzen:** Kein Zwischenspeichern – wer offline ist, verpasst das Event. Keine Auth auf dem POST.
- **Use Case:** Die Sängerin drückt am Dashboard „Rig wechseln“; der Kemper hängt aber am Tablet des Gitarristen → Server relayed das Kommando genau dorthin.

#### 3.7 Präsenz, Geräte-Info, Ping-Schleife (`presenceStore.ts`, `deviceInfoStore.ts`, `pingLoop.ts`) **[fertig]**
- **Was:** Präsenz = „welches Profil ist auf welchem Gerät gerade online“. Geräte-Info = IP, OS, Umgebung (`browser`/`pwa`/`native`), Sync-Status, Ping-Erreichbarkeit, Reverse-DNS-Hostname. Die Ping-Schleife pingt alle bekannten Geräte alle 20 s (`ping -c 1 -W 1`) und löst Hostnamen per `dns.reverse` auf.
- **Grenzen:** Alles nur RAM. `ping` wird als Systemkommando ausgeführt (setzt Linux mit `ping` voraus). Ohne Client-Report kein Eintrag.
- **Use Case:** „Device Ledger“: Der Techniker sieht, welches der vier Tablets seit 2 Minuten nicht mehr antwortet, bevor die Show startet.

#### 3.8 Discovery Mode (`discoverySessionStore.ts`, `midiWatcher.ts`) **[fertig – mit realem Hardware-Einsatz getestet, laut Roadmap #133–#138]**
- **Was:** Ein Admin startet eine bandweite Hardware-Erkennung. Jedes Tablet (per WebMIDI/WebUSB) *und* der Server selbst (native MIDI via `@julusian/midi`, Poll alle 2 s) melden erkannte Ports als „Kandidaten“. Der Store ordnet sie über `matchDetectedHardware` einem Plugin zu und versucht, offene Rollen (Logical Devices) automatisch zu besetzen: genau ein spezifischer Kandidat + genau eine offene Rolle → sofort zugewiesen; sonst „identifying“: Musiker führt eine im Plugin deklarierte Handlung aus (z. B. Kemper-Tuner an-aus = CC-Sequenz), der Server/das Tablet erkennt sie und bindet genau *dieses* Gerät; bei Timeout (Default 15 s) → „needs-manual“.
- **Wie:** Kandidaten werden 2 s „gesettled“, bevor neu berechnet wird. Gewonnene Server-Rollen schreibt der `midiWatcher` selbst als `DeviceTransportConfig` + `LogicalDevice`-Bindung nach CouchDB.
- **Grenzen:** Auto-Zuordnung nur bei *spezifischem* Match (Namensmuster/WebUSB), nicht bei Catch-all (`generic-webmidi`). Ausdrücklich: Multi-Instanz (zwei gleiche Geräte derselben Capability) ist bei *Cue-Ziel* nicht sauber gelöst (#149).
- **Use Cases:** (1) Zwei Gitarristen, zwei Kemper: Beide Kemper am Server-USB → System fragt „Marcos Kemper: Tuner kurz an/aus“ – wer es tut, gewinnt die Rolle. (2) Drummer steckt sein RC-500 ans Tablet → Toast „Neues Gerät erkannt, Rolle zuweisen“, beim nächsten Einstecken bindet es sich still (Auto-Memory).

#### 3.9 Server-Discovery im Netz (mDNS, Port-80-Redirect, `/server-info`) **[fertig]**
- **Was:** `stageboard.local` → LAN-IP per handgebautem mDNS-Responder (`multicast-dns`, eigener UDP-Socket, `setMulticastInterface(lanIp)`, um Docker-Bridges zu umgehen). Port 80 antwortet 301 auf HTTPS. LAN-IP per `LAN_IP` oder Auto-Erkennung (Docker/`br-`/`veth`-Interfaces übersprungen).
- **Grenzen:** Nur A-Record, kein vollständiges RFC-6762 (kein Probing/Announce). Port 80/443 brauchen `cap_net_bind_service`. Native Apps mit mDNS-Discovery: nicht gebaut (nur Browser).
- **Use Case:** Die Keyboarderin tippt „stageboard.local“ oder scannt den QR-Code im „Band einladen“-Dialog und ist im Netz.

#### 3.10 Clock-Sync-Gegenstelle (`GET /time`) **[fertig]**
- Ein Timestamp pro Anfrage, kein Zustand. Die eigentliche Intelligenz liegt im Client (`clockSync.ts`, siehe 6.1).

---

### 4. Datenmodell (`packages/shared-types`)

Alles ist Zod-validiert; die Typen sind die einzige Quelle für Client *und* Server.

| Schema | Inhalt / Besonderheiten |
|---|---|
| **Song** | `title, bpm, timeSignature ('4/4'), clickTrackEnabled, chordProContent, timecodes[], artist?` – dient auch als Lese-Spiegel der Default-Variante. |
| **SongVariant** | Vollständig eigenständige Arrangement-Kopie („Original“, „Akustik“, „Kurzfassung“): eigene `bpm`, `timeSignature`, ChordPro, `tracks[]` (Art: `reference` / `band-mix` / `stem`, Quelle: `upload` / `youtube-extract` / `stem-separation`), `cues[]` (ShowCue), `beatAnchors[]`, `tempoMarkers[]` (#141), `countInEnabled/countInBars`, `key/tuning/capo`. |
| **BeatAnchor** | Exakter Beat-Zeitpunkt (+ `beatInBar`) – Phasenkorrektur, *kein* Tempo. **TempoMarker** = echter Tempowechsel ab `timeMs`. |
| **ShowCue** | Hardware-Kommando am Song-Zeitpunkt, adressiert an ein **Logical Device**, nicht an eine Capability (#99). Gleiche Form wie ein `ShowControlEvent`. |
| **Setlist / SetlistEntry** | Eintrag hat eigene `id` (dasselbe Lied darf zweimal vorkommen, z. B. Voll- und Kurzfassung), `variantId`, `trackId`, **neu (#232)** `transitionType` (`manual` / `next-ready` / `seamless` / `delayed`) und `transitionDelayMs`. Beides optional → Altbestände laufen als `manual`. |
| **ShowState** | Singleton pro Band: aktive Setlist/Entry, **Master-Token** (`masterHolderId`), Transport (`playbackStatus`, `playbackStartedAt`, `playbackAccumulatedMs`), sowie for-tonight-Overrides: `trackOverride`, `liveTempoAdjustPercent`, `clickTrackOverride`, `clickExtendMs`, plus `currentShowId/lastActivityAt` fürs Log. |
| **ShowLogEvent** | `show-started`, `song-played` (mit `activeMs`), `capability-changed`, `note` – Ereignisse sind die „Show“, es gibt kein Summary-Dokument. |
| **Dashboard / WidgetInstance / LayoutItem** | Freies Raster pro Breakpoint (`sm/md/lg/xl`), Widget-Config je Instanz, `visibility`, `ownerProfileId/ownerRole` („Station“). |
| **Profile** | `name`, `stageRoles` (`performer`, `lighttech`, `soundtech`, `crew`, `admin`). |
| **Device** | Registrierte Tablets inkl. `firstSeenAt`, `lastSeenAt`, `revoked`. |
| **LogicalDevice** | Rolle („Marcos Kemper“) mit **einer** `capability`, plus Live-Bindung `pluginId` + `executionTarget` (`'server'` oder eine `Device.id`). Beide nullable (Teil-Setup). |
| **PluginInstallation** | Manifest (kein Code): `runtime` (`client`/`server`/`both`), `capabilities`, `transports` (z. B. `usb-midi` mit Feld `midiOutputId`), `hardwareIds` (WebMIDI-Namensmuster / WebUSB vendor+product), `discoveryTrigger`, `clientSource`, `source`. |
| **Discovery*, DeviceTransportConfig, DeviceInfo, Presence, PluginHealth, Lookup, Workspace-*** | Request-/Response-Schemas der Endpunkte aus Abschnitt 2 und der Live-Stores. |

**Capabilities (Kernvokabular, `capability.ts`):** `mixer`, `lighting`, `show-control`, `midi-input`, `audio-playback`, `click-track`, `backup`, `audio-analysis`. Community-/Geräte-Plugins bringen eigene Strings mit (offener String-Typ) – siehe 5.

---

### 5. Plugin-System & Capabilities

**Zwei Plugin-Familien im Server:** `IShowControlPlugin` (`trigger(event)`, Hardware/Cues) und `ILookupPlugin` (`search`/`fetchDetail`, Datenquellen).
**Client-Seite:** `Translator` (`(event) => Promise<ShowControlResult>`), statisch registriert *oder* dynamisch aus einem ES-Modul-Bundle geladen.

#### 5.1 Katalog (`stage-pwa/src/lib/pluginCatalog.ts`, installierbar im PWA)

| Plugin-ID | Runtime | Capability | Transport | Realer Einsatz? | Server-Impl.? |
|---|---|---|---|---|---|
| `mock-mixer` | both | `mixer` | `network-osc` | Mock | ja (`mock-mixer`) |
| `generic-webmidi` | client | `midi-input` | – (Catch-all-Erkennung) | **ja** (Fußtaster → nächster Song-Part) | – |
| `kemper-profiler` | client | `kemper-control` | `usb-midi` | **ja** (Rig wählen, Stomp) | – |
| `cq18t-mixer` | client | `cq18t-control` | `usb-midi` | **ja** (Level, Mute; A&H CQ-18T) | – |
| `nux-mg30` | client | `mg30-control` | `usb-midi` | **ja** (Patch, Knopf) | – |
| `boss-rc500` | client | `rc500-control` | `usb-midi` | **ja** (Speicher wählen) | – |
| `soundcraft-ui24r` | client | `ui24r-control` | `network-ws` (WebSocket) | **ja** (Level, Mute) | – |
| `mock-lighting` | both | `lighting`, `show-control` | – | Mock | ja |
| `mock-backup` | server | `backup` | – | Mock | **nein** |
| `mock-playback` | server | `audio-playback` | – | Mock | ja |
| `music-tempo-beat-detection` | client | `audio-analysis` | – | **ja** (BPM/Beat-Erkennung, optional) | – |
| `mock-click` | server | `click-track` | – | Mock | **nein** |

Client-Translatoren: `kemperTranslator` (`kemper.selectRig`, `kemper.stomp`), `cq18tTranslator` (`cq18t.setLevel/setMute`), `mg30Translator` (`mg30.selectPatch/setKnob`), `rc500Translator` (`rc500.selectMemory`), `ui24rTranslator` (`ui24r.setLevel/setMute`, eigene Socket.IO-0.9-Textklammer in `ui24rSocket.ts` und Fader-Kurve `ui24rCurves.ts`); jeder kennt zusätzlich ein `test`-Event. `clickTrack`-Translator kennt `click.extend` (#231, Takte verlängern). Mixer-/Lighting-Translatoren sind lokale Mock-Stores (`useLocalMixerStore`, `useLocalLightingStore`).

#### 5.2 Dynamisches Client-Laden (`loadClientPlugin.ts`, `clientPluginModule.ts`, `useDynamicTranslatorPreload.ts`) **[teilweise]**
- **Wie:** Bundle-URL = Stage-Server-Mirror (`/plugins/:id/client.js`) falls Server konfiguriert, sonst `clientSource`. Blob wird in der Cache-API (`stageboard-plugins`, Schlüssel `id@version`) gehalten und per `import(blobUrl)` geladen. `registerTranslator(capability)` liefert den Translator.
- **Grenzen:** `ClientPluginModule` deklariert außerdem `registerWidgets`, `registerEditorPanel`, `registerHalProbe` – **es gibt dafür keinen Konsumenten** (bewusst lose getypt). Kein Sandbox-/Signatur-Schutz: Plugin-Code läuft mit voller Seitenberechtigung. Server-Code aus `source` laden ist nicht gebaut (#17 offen).
- **Use Case:** Ein Community-Entwickler veröffentlicht `@stageboard/plugin-boss-katana`; die Band trägt die URL ein, alle Tablets laden es einmal und haben danach auch offline die Steuerung.

#### 5.3 HAL / Hardware-Routing (`hardwareRouting.ts`, `useCapabilityRouting.ts`, `useHardwareDetection.ts`, `hardwareDeviceMemory.ts`, `webMidi.ts`, `webMidiOutput.ts`, `webUsb.ts`, `shared-types/hardwareMatching.ts`) **[fertig]**
- **Was:** Ein Widget/Cue fragt „wohin geht diese Capability?“ und bekommt eine von vier Antworten: `plugin` (Stage-Server-Plugin), `local-mine` (dieses Tablet führt selbst aus), `local-other` (ein anderes Tablet führt aus, dieses tut nichts), `none` (nichts gebunden → Widget grau).
- **Wie:** `resolveExecutionEngine(mode, logicalDevice, deviceId, pluginId, supportsLocalExecution)`. **Practice-Modus** überspringt das Routing komplett und führt lokal aus, wenn irgendwas lokal ausführen kann. Die Erkennung (`useHardwareDetection`) hört auf WebMIDI-Verbindungen und bereits gekoppelte WebUSB-Geräte, matcht gegen `hardwareIds` der installierten Plugins und schreibt bei Zuweisung `DeviceTransportConfig` + Bindung und merkt sich das Paar in `localStorage` (Auto-Memory, Schlüssel = `hardwareKeyFor(detected)`).
- **Grenzen:** WebMIDI liefert nur Name/Hersteller-Strings (keine Vendor-/Product-IDs) → Match ist Namens-Substring (case-insensitive). Ein Logical Device hat genau *eine* Capability. Ohne HTTPS (Secure Context) kein WebMIDI/WebUSB auf dem Tablet (siehe `docs/03`). Cue-Adressierung bei mehreren gleichartigen Geräten (#149) offen.
- **Use Cases:** (1) Der Gitarrist steckt seinen Kemper per USB ans Tablet; die Cues „Rig 3 bei Takt 32“ feuern lokal, ohne Netzwerkverkehr. (2) Der Techniker bindet das Ui24R (WebSocket) an den Server – jeder Fader-Befehl der Sänger-Tablets läuft über den Server-Plugin-Weg.

#### 5.4 Cue-Ausführung (`cueFiring.ts`, `useCueScheduler.ts`) **[fertig, nicht sample-genau]**
- **Was:** Jedes Tablet beobachtet die synchronisierte Abspielzeit und feuert Cues der aktuellen Variante, deren `timeMs` überschritten wurde – aber nur, wenn *dieses* Tablet an das Ziel-Logical-Device gebunden ist (`local-mine`); bei `plugin` wird zum Server weitergeleitet; bei `local-other`/`none` passiert nichts (das andere Tablet läuft mit derselben Uhr und feuert selbst → null Netzwerkverkehr für vorab bekannte Cues).
- **Grenzen (wichtig):** Umsetzung ist Polling der Elapsed-Zeit (~60 fps über `requestAnimationFrame`), **nicht** das in `docs/00 §4` beschriebene Sample-genaue Web-Audio-/`midiOutput.send(data, time)`-Scheduling. Nur im Gig-Modus. Der manuelle Cue-Recorder (#6), Auto-Cue-Erkennung (#7) und Live-Firing/Post-Show-Persistenz (#8) sind **[geplant]**; der Cue-*Editor* („CueListEditor“) existiert allgemein.
- **Use Cases:** (1) „Bei Takt 32 Lichtszene ‚Refrain‘“ wird im Song-Editor an den Song geheftet und läuft bei jedem Gig automatisch. (2) Beim Ad-hoc-Event „Nebel!“ (Knopf) läuft der Weg über den Server statt über die Timeline.

---

### 6. Domain-Logik im Client (`stage-pwa/src/lib`)

#### 6.1 Clock-Sync (`clockSync.ts`, `useClockSync.ts`) **[fertig, live verifiziert]**
- **Was:** NTP-artige Zeitabgleichung zwischen Tablet und Server-Uhr.
- **Wie:** Burst von 7 `GET /time`-Anfragen; Offset = Server-Zeit − Mittelpunkt des Round-Trips. Basis ist die Probe mit der kleinsten RTT. Bei *asymmetrischen* WLAN-Pfaden (Offset korreliert mit RTT) wird per Regressionsgerade auf RTT=0 extrapoliert – nur wenn RTT-Spreizung ≥ 10 ms, ≥ 3 Proben und R² ≥ 0,5, sonst Fallback. Wiederholung alle 60 s. `driftMs` (Spreizung der Offsets der letzten 5 Bursts) ist das Vertrauenssignal, nicht `jitterMs`. Nie ein Wurf – bei Fehlschlag bleibt der letzte Stand.
- **Grenzen:** Genauigkeit im Bereich weniger ms auf gutem WLAN; auf schlechtem WLAN bleiben Ausreißer. Ohne konfigurierten Stage-Server keine Synchronisierung (Solo-Betrieb nutzt lokale Uhr).
- **Use Case:** Alle vier Tablets scrollen den Text im selben Moment, auch wenn ihre Systemuhren 1,3 s auseinanderliegen.

#### 6.2 Transport / Queue / ShowState / Master-Token (`playbackTransport.ts`, `computeQueue.ts`, `queue.ts`, `showMode.ts`, `store/useShowStateStore.ts`) **[fertig]**
- **Was:** Setlist-Reihenfolge (oder ganzer Katalog, wenn keine Setlist aktiv ist), aktuelles/nächstes/vorheriges Lied, Play/Pause/Stop/Reset, Weiter/Zurück, Track-Override, Live-Tempo-Nudge (±15 %, nur Klick), Klick-Override, Takte verlängern.
- **Wie:** Der Transport ist reiner Wert (`status`, `startedAt`, `accumulatedMs`); Zeit = `accumulated + (jetzt − startedAt)` solange „playing“. Nur der **Master-Token-Halter** schreibt ShowState (`isMaster` wird in jeder Aktion geprüft); Übernahme = einfaches Schreiben von `masterHolderId` (CouchDB-Konflikte reichen als „nur ein Gewinner“). Variantenauflösung: Eintrag-Variante → Default-Variante; Track: Override → Eintrag-`trackId` → `band-mix` → erster Track. `useShowMode()` liefert dieselbe Schnittstelle für **Gig** (geteilter ShowState) und **Solo Üben** (lokaler `usePracticeStateStore`, nie geteilt).
- **Neu in dieser Session:** #233 (Solo→Gig setzt Übungswiedergabe zurück statt zu blockieren; Gig→Solo bleibt blockiert), #234 (Queue-Widget modusbewusst, Setlist-Wähler für Solo), #232 (Übergangstypen, siehe 6.6).
- **Grenzen:** **Kein Master-Heartbeat/Force-Override (#32 offen)** – fällt das Master-Tablet aus, muss jemand manuell „Master übernehmen“ drücken. `playbackStartedAt` wird mit dem *lokalen* `Date.now()` des Masters geschrieben, während Leser die Zeit mit `getServerTime()` (Server-Zeit) rechnen (`queue.ts:122` vs. `usePlaybackElapsedMs.ts:33`); das stimmt exakt nur, wenn die Master-Systemuhr ≈ Server-Uhr ist (Code-Lesart, **nicht live geprüft**). Master-Modus pro Gerät/Konto nicht wählbar (#85).
- **Use Cases:** (1) Der Sänger drückt „Nächster Song“; alle Tablets wechseln synchron. (2) Ein Zuschauerwunsch: Der Bandleiter zieht „Wonderwall“ per „Als nächstes spielen“ direkt hinter den laufenden Titel.

#### 6.3 Show-Log / Nachbericht (`showLogTracking.ts`, `useShowLogTracker.ts`, `store/…ShowLog`) **[fertig]**
- **Was:** Protokolliert Songs (`song-played` mit aktiver Dauer ohne Pausen), Show-Start, Capability-Wechsel („IEM ausgefallen“) und Notizen.
- **Wie:** Song zählt erst ab 20 s aktiver Spielzeit (`MIN_SONG_DURATION_MS`, verhindert Fehltipp-Einträge). Neue „Show“ nach 45 min Pause (`SHOW_GAP_THRESHOLD_MS`). Erfassung passiert direkt in den Transport-Aktionen des Masters; Capability-Änderungen beobachtet `useShowLogTracker` reaktiv (nur beim Master).
- **Grenzen:** Telemetrie/Analysen über mehrere Gigs (#64) und Ready-Check (#60) fehlen.
- **Use Case:** Nach dem Gig zeigt der Nachbericht: 14 Songs, 1:32 h, 20:47 Uhr „Mischpult offline“ – für die Gagenabrechnung/GEMA-Meldung.

#### 6.4 Klick, Metronom, Beat-Grid (`metronome.ts`, `clickEngine.ts`, `useClickOutputDriver.ts`) **[fertig]**
- **Was:** Hörbarer Klick (Web Audio, Downbeat höher/lauter) und visuelles Metronom teilen sich dieselbe Beat-Grid-Berechnung. Unterstützt: Taktarten, Beat-Anker (Phasenkorrektur), Tempomarker (echte Tempowechsel), Einzähler (auch negative Startzeit, wenn er nicht ins Intro passt), Live-Tempo-Nudge, Klick an/aus-Override.
- **Wie:** Look-ahead-Scheduler nach „A Tale of Two Clocks“ (kurzes Vorlauffenster, Cursor wächst inkrementell statt jedes Mal neu berechnet). Stall-Erkennung (Tab im Hintergrund → Neu-Ankern statt Klick-Salve). Wird beim Verstecken/Fokusverlust der Seite hart gestoppt (iOS-Eigenheit), beim Zurückkehren sauber neu gestartet.
- **Grenzen:** Ein Tempowechsel per Live-Nudge gilt nur für Segment 0 (Marker-Tempi bleiben unverändert). Klick zu Hardware routen (Ausgabe an ein Gerät/IEM) ist an den Routing-Layer gekoppelt; das Issue #25 (Visual Metronome & hardware-routed Click) ist noch offen, obwohl Klick und Metronom schon liefen.
- **Use Cases:** (1) Der Drummer bekommt den Klick nur auf sein Tablet/seine In-Ears, der Rest hört nichts. (2) „Die Band schleppt heute“ – Tempo-Nudge +3 % ohne den gespeicherten BPM anzufassen.

#### 6.5 Audio: Engine, Cache, Sync-Abgleich, Analyse
**`localAudioEngine.ts` [fertig]:** Ein `<audio>`-Element pro Tablet; Load/Seek/Play/Pause/Stop, Drift-Korrektur (Re-Seek bei > 200 ms Abweichung zur Master-Uhr), Rückgabe echter Autoplay-Fehler statt stillem Scheitern (führt zum „Tippen zum Fortsetzen“-Overlay). **Neu (#232):** zweites, vorgepuffertes Element für nahtlose Übergänge (`preloadLocalTrack`, `loadLocalTrack` tauscht es ein). Nur wirksam, wenn dieses Tablet lokal spielt; Server-Audioplugins werden nicht vorgeladen.

**`audioCache.ts`, `audioStorageBackend.ts`, `audioStorageManager.ts`, `useAudioSyncReconciler.ts` [fertig]:** IndexedDB-Cache für Track-Blobs hinter einer austauschbaren Backend-Schnittstelle (Vorbereitung für native Hülle). Drei Sync-Modi: `none` (nur was gerade läuft bleibt), `selective` (aktive Setlist + angepinnte Songs), `full` (alles – nur solange unter 80 % des Speicherkontingents, `isFullSyncSafe`). Der laufende Song wird immer gehalten, damit ein Reload mitten im Lied nicht vom Netz abhängt. Gleichzeitige Reconcile-Läufe werden zusammengefasst (Race-Fix vom 2026-09-16).
- **Grenzen:** Kein Fortsetzen abgebrochener Downloads. Server liefert ganze Dateien; parallele Downloads können die geteilte HTTP/2-Verbindung sättigen (docs/11: ~1,2 s Rest-Latenz kleiner Antworten während eines Streams, bewusst offen).
- **Use Case:** Im Keller des Clubs gibt es kein WLAN mehr – alle für heute nötigen Tracks liegen bereits auf dem Tablet.

**Analyse (`audioAnalysis.ts`, `analyzeTrack.ts`, `musicTempoAnalysis.ts`, Worker) [fertig, optional teilweise Plugin]:** Handgeschriebene DSP: Spektralfluss-Onset-Hüllkurve, erster Onset, Autokorrelation für BPM (Bereich einstellbar), Beat-Tracking über den ganzen Track (Anker-Korrekturen nur, wenn die *folgende* Beat-Position sie bestätigt), Tempo-Map (Viterbi über 8-s-Fenster) für Tempowechsel. Optional der Anbieter `music-tempo` (Plugin `music-tempo-beat-detection`, in Web Worker; 44,1 kHz-Annahme wird durch Resampling erfüllt). Manuelles Tap-Sync steht immer zur Verfügung.
- **Grenzen:** Erkennung ist Assistenz, keine Wahrheit (Marcos Regel: gegen Ground-Truth prüfen). Echte Tempowechsel werden bewusst *nie* automatisch gesetzt (Marker sind manuell), nur die Tempo-Map liefert einen Vorschlag.
- **Use Cases:** (1) „Track analysieren“ liefert BPM 118 und ein Beat-Raster, der Klick liegt sofort auf dem Backing-Track. (2) Für den Schlussteil mit Ritardando setzt der Drummer per Hand einen Tempomarker.

**Stems / YouTube-Extraktion / Async-Jobs (#9, #5, #66)** sind **[geplant]** – `TrackMeta.source` kennt bereits `youtube-extract`/`stem-separation`, aber es gibt keine Pipeline dazu.

#### 6.6 Übergangstypen (#232, neu, `trackEndTransition.ts`, `useAutoStopDriver.ts`) **[fertig – nicht auf echtem Tablet geprüft]**
- **Was:** Pro Setlist-Eintrag legt man fest, was am *Ende des Backing-Tracks* passiert: `manual` (Stopp – bisheriges Verhalten), `next-ready` (Stopp, nächster Song wird bereitgestellt), `seamless` (nächster Song startet sofort, ohne Einzähler, Klick wechselt in das Raster des nächsten Songs), `delayed` (nächster Song startet nach `transitionDelayMs`, mit seinem normalen Einzähler). Ohne Nachfolger → Stopp.
- **Wie:** Ende = `elapsedMs ≥ Tracklänge + clickExtendMs` (die „Takte verlängern“-Taste verschiebt damit auch den Übergang). Die Entscheidung ist eine reine Funktion (`resolveTrackEndAction`, getestet). Setlist-Editor: „→“-Knopf pro Zeile.
- **Grenzen:** Greift nur auf dem Gerät, das den Track lokal geladen *und* Master ist (bei Master ≠ Audio-Tablet kein Auto-Stopp – dieselbe Einschränkung wie #231). `delayed` ist ein lokaler Timer (geht bei Reload verloren). `crossfade` ausdrücklich nicht enthalten (#244). Unverifiziert: Ob ein Gig-Modus-`delayed`-Start den Einzähler bekommt (der Eintrag zählt dort schon als „gestartet“).
- **Use Cases:** (1) „Highway to Hell“ → „Whole Lotta Rosie“ sollen ineinander laufen: erster Eintrag `seamless`. (2) Zwischen zwei Songs sind 8 s Ansage gewünscht: `delayed`.

#### 6.7 ChordPro, Prompter-Logik, Tap-to-Sync (`chordpro.ts`, `useMidiTrigger.ts`) **[fertig]**
- **Was:** Parser für `[G]Text`, Zeit-Tags `[mm:ss.xx]`, Part-Direktiven (`{part: Chorus}` plus Standard-Aliasse `{soc}/{sov}/{sob}` und `{start_of_…}`), Kommentar-Direktiven (`{c:}`, `{comment:}`, `{cc:}`, `{cc4all:}`, **adressiert** `{cc4marco,jamie: …}` – nur für genannte Profilnamen sichtbar, unauflösbare Namen zeigen den Kommentar allen). Seiteneinteilung für die geblätterte Ansicht (eine Seite pro Part, sonst 6er-Blöcke), aktuelle Zeile/Seite aus der Uhr, `nextSectionIndex` für den manuellen Umblätter-Modus per Fußtaster (WebMIDI Note-On/Program-Change).
- **Grenzen:** **Keine Transposition/Kapo-Engine im Code** (kein einziger Treffer für „transpos“ in `stage-pwa/src`) – #59 **[geplant]**. `{key}`/`{capo}` stehen nur als Variantenfelder, ohne Umrechnung der Akkorde.
- **Use Cases:** (1) Der Gitarrist bekommt „{cc4jamie: Solo eine Oktave höher}“ nur auf seinem Bildschirm. (2) Ohne Timecodes blättert der Fußtaster (MIDI) zum nächsten Part.

#### 6.8 Tuner (`pitchDetection.ts`, `noteFromFrequency.ts`) **[fertig]**
- **Was:** Mikrofon-basiertes Stimmgerät – Autokorrelation mit parabolischer Interpolation, RMS-Schwelle, Frequenz→Note (gleichstufig, Referenz-A einstellbar, Standard 440 Hz).
- **Grenzen:** Kein polyphones Stimmen, keine alternativen Temperierungen. Braucht Mikrofon-Berechtigung (Secure Context).
- **Use Case:** Der Bassist stimmt zwischen zwei Songs auf dem Tablet, ohne Stimmgerät-Pedal.

#### 6.9 Workspace-Daten, Sync, Snapshots (`workspaceDb.ts`, `workspaceCollection.ts`, `trackedSync.ts`, `useWorkspaceResource.ts`, `workspaceAccessDoc.ts`, `workspaceSnapshot.ts`) **[fertig]**
- **Was:** Eine lokale PouchDB pro Band, alle Sammlungen als Dokumente mit `<kind>:<id>`-Präfix in *einer* Datenbank/*einem* Live-Sync (löst das 6-Verbindungen-Limit von HTTP/1.1). `trackedSync` reiht Syncs ein und meldet Status. `WorkspaceAccessDoc` (schreibgeschützt für Clients) trägt Band-Code und Anzeigename. Snapshot-Export/-Import als Backup (nicht Show-Zustand/Health).
- **Grenzen:** Snapshot ist manuell (das Backup-Plugin ist Mock, Server-Auto-Backup **[geplant]**). Clients sind für den Sync auf den Stage-Server-Proxy angewiesen (`remoteDbUrl`), es gibt kein P2P zwischen Tablets ohne Server.
- **Use Case:** Zuhause im Zug Setlist umbauen – im Proberaum verschmilzt PouchDB die Änderungen automatisch mit der CouchDB.

#### 6.10 Sonstiges (kleine, aber reale Bausteine)
- **`useWakeLock.ts` [fertig]:** hält den Bildschirm wach, holt die Sperre nach jedem Sichtbarwerden neu. *Use Case:* Tablet klemmt am Mikrofonständer.
- **`detectEnvironment.ts`, `reportDeviceInfo.ts`, `usePresenceReporter.ts`, `reportClientHealth.ts`, `presenceStream.ts`, `pluginHealthStream.ts`, `stageServerStatusCache.ts` [fertig]:** Meldungen an bzw. Streams vom Server; `stageServerStatusCache` zeigt den letzten bekannten Serverstatus sofort statt „Lade…“.
- **`useCapabilities.ts`, `capabilities.ts` [fertig]:** Capability-Status `available` / `degraded` (installiert, aber Herzschlag stale/Plugin weg) / `missing` (nicht installiert → Widget wird gar nicht erst angeboten).
- **`lookupClient.ts`, `deviceControlClient.ts`, `showControlClient.ts` [fertig]:** dünne HTTP-Clients für 2.3/2.4.
- **`ui24rSocket.ts` [fertig]:** Socket.IO-0.9-artiges Text-Protokoll über `ws://` (reverse-engineered, MIT-Quelle angegeben); Verbindung pro `host:port` gecacht. *Grenze:* `ws://` aus einer HTTPS-Seite kann Mixed-Content-Sperren auslösen.

---

### 7. Geplant, aber nicht gebaut (Stand offene Issues, 34)

| Bereich | Issues |
|---|---|
| **Live-Show-Automatik** | #6 Cue-Recorder, #7 Auto-Cue-Erkennung, #8 Live-Cue-Firing + Post-Show-Persistenz, #32 Master-Heartbeat/Force-Override |
| **Setlist/Fluss** | #28 Festival-Uhr, #29 Übergangsnotizen/Show-Flow-Items, #244 Crossfade, #183/#182 geführte Song-/Setlist-Anlage |
| **Musiker-Werkzeuge** | #59 Transposition/Kapo, #61 Loop/Speed-Trainer, #24 Akkord-Lookup + Quintenzirkel, #60 Ready-Check, #26 Stage-Messenger, #27 Bluetooth-Fußtaster (Tastenbelegung) |
| **Audio-Pipeline** | #5 Async-Jobs/YouTube-Extraktion, #9 Stem-Trennung, #66 Tone-Match (IR), #63 Ansage-TTS für In-Ears |
| **Hardware/Architektur** | #149 Multi-Instanz-Routing, #62 räumliche Bühnenmatrix, #17 dynamischer Server-Plugin-Code, #36 Kern-vs-Plugin-Grenze |
| **Konten/Sicherheit** | #57 Rollen-Zugriff auf Widgets, #16 Read-only-Vorlagen-Dashboards, #70 Break-Glass-CLI, #84 Band auf abweichendem Server, #85 Master-Token-Modus |
| **Sonstiges** | #14 Live-Debug-Konsole, #15 Robustheit UG/MusicBrainz, #25 Visual-Metronome/Click (Feature-Kern läuft, Issue offen), #64 Post-Gig-Telemetrie, #65 Publikums-QR-Jukebox, #213 Container-Widgets |

**Laut Ausbaustufen-Doku (`docs/02`) nicht vorhanden:** Auto-Failover A/B-Server (Stufe 5), Cloud-Sync/VPS (Stufe 4), Auto-Backup auf USB/NAS, Multikanal-Audio-Routing (Dante/USB-Interface), echte Mixer-/DMX-Server-Adapter, Native-App-mDNS-Discovery.

---

### 8. Abweichungen Doku ↔ Code und Auffälligkeiten

1. **Ahead-of-Time-Dispatch (`docs/00 §4`) nur halb gebaut.** Der Server-Gateway unterstützt `scheduledAt` (`POST /plugins/:name/trigger` wartet bis dahin), aber **kein Client-Code sendet je `scheduledAt`** (kein Treffer in `stage-pwa/src`). Cues werden per ~60-fps-Polling der Elapsed-Zeit gefeuert, nicht per Web-Audio-`start(time)`/`midiOutput.send(data, time)`; `setTimeout` wird im Deferred-Count-in-Pfad (`practiceQueue.ts`) und im neuen `delayed`-Übergang genutzt.
2. **Uhr-Basis beim Transportstart** – Master schreibt lokale `Date.now()`, Leser rechnen mit Server-Zeit (6.2). Bei stark abweichender Master-Uhr entstünde ein konstanter Versatz. Nicht live gemessen.
3. **Unauthentifizierte Routen:** `PUT/GET/DELETE /audio/*`, `POST /plugins/:name/trigger`, `POST …/devices/:id/trigger`, alle Discovery-POSTs, Präsenz/Health/Device-Info-Reports. Modell = „Wer im Band-WLAN ist, vertraut sich“. Ein Fremder im selben Netz könnte Audio überschreiben/löschen. Für Touring mit fremdem Venue-WLAN relevant.
4. **CouchDB-Default `admin/admin`** im Code, wenn keine Umgebungsvariablen gesetzt sind.
5. **Server-Plugin-Katalog ≠ PWA-Katalog:** `mock-backup` und `mock-click` sind im PWA installierbar, laufen serverseitig aber ins Leere („unavailable“, nur ein Log-Eintrag).
6. **Flüchtiger Serverzustand:** Präsenz, Geräte-Info, Plugin-Health, Discovery-Session, PIN-Sperre und Geräte-Relay-Abonnements sind nach Neustart leer; Clients füllen sie durch zyklische Reports wieder auf.
7. **`docs/05` teilweise veraltet:** Einige dort noch als offen geführte Issues (z. B. #18/#22/#23/#35, #106) sind laut GitHub geschlossen bzw. gelten als ausgeliefert.
8. **Build-Warnung:** `practiceQueue.ts` und `useAppModeStore.ts` sind in `clientTranslator.ts` dynamisch, sonst statisch importiert → Rolldown meldet `INEFFECTIVE_DYNAMIC_IMPORT` (harmlos; die dynamischen Imports existieren, um PouchDB im Test nicht laden zu müssen).
9. **Ultimate-Guitar-Scraper braucht Chrome/Chromium auf dem Server** und ist von der UG-Seitenstruktur abhängig (#15).
10. **Native MIDI im Server:** `midiWatcher` nutzt `@julusian/midi` (natives Modul); scheitert das Auflisten der Ports, wird nur „Failed to enumerate native MIDI ports“ geloggt (Code-Lesart; Verhalten auf einem System ohne MIDI-Zugriff nicht getestet).
