# UI/UX Konzept: Das modulare Bühnen-Interface

Um alle Geräte vom 6-Zoll-Smartphone bis zum 24-Zoll-Monitor zu bedienen, nutzt die PWA ein Widget-basiertes Layout-System.

## 1. Die Grundphilosophie

* **Dark Mode & Light Mode Toggle:** Auf der Bühne ist der Dark Mode (reines OLED-Schwarz, `#000000` kombiniert mit hochkontrastigen Farben) der unverrückbare Standard, damit nichts blendet und die Augen nicht ermüden. Für die Vorbereitung unterwegs (z.B. im Zug, bei Tageslicht oder auf der Terrasse) gibt es einen gestochen scharfen Light Mode (schwarze Schrift auf reinweißem oder leicht mattem Hintergrund), um Reflexionen auf dem Display zu kontern.
* **Touch-First & "Fat Finger" Design:** Keine winzigen Dropdowns im Live-Modus. Alle aktiven Schaltflächen (Next Song, More Me, Panic Button) sind riesig, damit man sie notfalls auch schweißgebadet oder aus dem Augenwinkel trifft. Konkret (seit dem Bühnen-Audit 2026-09-26/27): Show-Aktionen ≥ 72 px, alle übrigen Bedienelemente auf der Bühne ≥ 56 px, Text ≥ 16 px - je Widget festgelegt über die Bühnen-Stufe (Abschnitt 3).
* **Intelligente & gerätespezifische Profile ("Stations"):** Um Musiker nicht zu überfordern, hat jedes Dashboard je Bildschirmklasse (Handy, Tablet hoch, Tablet quer, großer Bildschirm) ein eigenes Raster; wer nur eine davon anordnet, bekommt die anderen automatisch abgeleitet (siehe "Drehen ohne Einrichten" in Abschnitt 2), gespeichert wird nur, was jemand selbst anordnet. Profis können jedoch gerätespezifische Setups ("Stations") in ihrem Profil speichern. So hat der Sänger am vorderen Mikrofon-Tablet (Hochformat) nur Text, während er am Keyboard-Tablet (Querformat) sein "More Me"-Widget sieht. Die App merkt sich pro Endgerät, welche Station zuletzt geladen war.
 * **Umsetzungsstand:** Der geteilte Teil ist als **Dashboards** umgesetzt (siehe Abschnitt 2) — jedes Dashboard bringt pro Bildschirmklasse ein eigenes Raster mit, und jedes Endgerät merkt sich, welches Dashboard es zuletzt zeigte. Vollständig *persönliche* Dashboard-Sets pro Gerät ("Stations" im engeren Sinn) bauen darauf auf und sind noch offen.

## 2. Dashboards & Navigation

Ein Bildschirm reicht nicht: der Prompter, das Monitoring-Cockpit und die Lichtsteuerung wollen jeweils den ganzen Platz. StageBoard kennt deshalb beliebig viele **Dashboards** — benannte, frei konfigurierbare Seiten (z.B. "Prompter", "Monitoring", "Light").

* **Ein Dashboard ist eine Seite mit eigenem Raster.** Anlegen, umbenennen, duplizieren, löschen und sortieren passiert im Edit-Modus (Abschnitt 5). Das letzte Dashboard lässt sich nicht löschen — ein Gerät ohne Dashboard hätte nichts anzuzeigen.
* **Ein Dashboard bedient alle Gerätegrößen.** Statt pro Gerät zu existieren, hält es je Bildschirmklasse (`sm`/`md`/`lg`/`xl`, siehe die Szenarien in Abschnitt 4) ein eigenes Raster. Wer das Layout am Bühnen-Monitor umbaut, zerstört damit nicht die Tablet-Ansicht.
* **Dashboards je Modus:** Jedes Dashboard ist im Modus **Gig**, in **Solo Üben** oder in beiden verfügbar (Dashboard-Einstellungen im „⋯“ der Edit-Leiste: „Anbieten in“ Gig / Solo, Standard: beide). Menü und Dashboard-Umschalter zeigen nur die Dashboards des aktuellen Modus; beim Moduswechsel springt das Gerät auf das Dashboard, das es in diesem Modus zuletzt gezeigt hat. So bleibt die Gig-Auswahl schlank, während Probe-Dashboards (Loop-Trainer, Quintenzirkel …) nur in Solo Üben auftauchen. Jeder Modus behält mindestens ein Dashboard - der letzte Chip eines Modus ist gesperrt; bliebe über private Stations dennoch keines übrig, zeigt das Gerät alle sichtbaren Dashboards statt eines leeren Bildschirms (Marco, 2026-09-27).
* **Drehen ohne Einrichten (2026-09-27):** Jede Bildschirmklasse hat ihr eigenes Raster, aber niemand muss jede selbst anordnen. Ein neues Widget landet in jedem Raster unter den vorhandenen, sonst an der ersten freien Stelle in voller Größe - nicht mehr als 1-Zeilen-Streifen. Sind in einem Raster trotzdem Widgets auf höchstens die Hälfte ihrer Mindestgröße zusammengedrückt (etwa ein nur im Hochformat angeordnetes Dashboard im Querformat), zeigt das Gerät außerhalb des Bearbeitens eine reparierte Anordnung: zuerst werden nur diese Widgets in freien Platz umgesetzt, sonst wird das ganze Raster pixelgetreu aus der am besten angeordneten Bildschirmklasse abgeleitet. Das ist reine Anzeige und wird nie gespeichert; im Edit-Modus zeigt ein Banner die Zahl der zu kleinen Widgets mit „Zu kleine Widgets neu platzieren" bzw. „Aus Hochformat übernehmen", erst das speichert.
* **Statusleiste (2026-09-27):** Oben auf jedem Bildschirm eine feste Leiste: Menü, Zustand, Song mit Laufzeit, Gig/Solo, Uhrzeit, Musiker, Sync und das Master-Token. Die Leiste ist in der Farbe des Zustands eingefärbt (grau bereit, blau einzählen, grün spielt, amber Pause, magenta beendet, rot nur bei Fehlern - immer zusammen mit dem Wort) und zeigt beim Einzählen links einen Zählblock (Zählzahl, Schlag-Punkte, Takt 1/2), der auf jedem Schlag im Songtempo aufblitzt, damit die Band vor dem ersten Takt im Tempo ist - die übrige Leiste bleibt dabei ruhig. Ein Dashboard kann sie ausblenden (z. B. reiner Prompter); dann erscheint das Menü als schwebender Knopf unten rechts. **Nach Rangfolge (#429, 2026-10-07):** Fester Kern sind ☰, das Zustands-Symbol (■ ▶ ❚❚ ✓ ⚠ - bleibt immer), Songtitel und Laufzeit; alles andere (Songlänge, Master-Krone, Uhrzeit, Zustand als Wort, Sync-Symbol, Gig/Solo, Name, Ansicht, Sync als Wort) gibt in dieser Reihenfolge von hinten Platz ab, bis der Titel mindestens 160 px behält - gemessen, nicht über feste Bildschirmbreiten. Rangfolge und Ausblenden je Gerät unter Einstellungen → Statusleiste; Code `lib/statusBarItems.ts`.
* **Umgeschaltet wird über das Menü oder ein Widget:** Die Dashboard-Liste im Menü (☰) schaltet um; zusätzlich rendert das "Dashboard-Umschalter"-Widget große Buttons (horizontal als Leiste oder vertikal als Spalte, pro Instanz einstellbar) und liegt selbst im Raster. Es zeigt **genau die Liste des Menüs auf diesem Gerät** (sichtbar für diese Person, im aktuellen Modus angeboten, in der eigenen Reihenfolge, ohne Ausgeblendete) - eine eigene band-weite Auswahl hat es seit #422 nicht mehr. So entscheidet jeder Bildschirm, ob er neben dem Menü eine Navigation im Raster braucht.
* **Geteilt, aber lokal ausgewählt:** Dashboards replizieren band-weit wie Setlisten. Der Bandleader baut "Light" einmal, der Lichtmensch wählt es auf seinem Tablet aus. *Welches* Dashboard offen ist, bleibt eine reine Geräte-Einstellung und überlebt den Reload - ebenso Reihenfolge und Ausblenden in der Menü-Liste (#422). Ein neues Dashboard ist zuerst privat („Nur ich“) und wird in den Dashboard-Einstellungen für die ganze Band geteilt; ein Admin kann ein Dashboard als **Vorlage schützen** (#16) - dann ändern es nur Admins (auch vom CouchDB-Validator durchgesetzt), alle anderen bekommen „Eigene Kopie bearbeiten“.

## 3. Die UI-Bausteine (Widgets)

**Bühnen-Stufen (Stage Tier):** Jedes Widget trägt eine Stufe, die festlegt, wie groß es sein muss (GUI-Audit 2026-09-26, mit Marco festgelegt 2026-09-27; Größen-Tokens in `index.css`, Textuntergrenze in `lib/stageSize.ts`):
* **Gig** - wird mitten im Song bedient oder gelesen: Show-Aktionen ≥ 72 px, übrige Ziele ≥ 56 px, Text ≥ 16 px, Kernwerte (Zeit, BPM, Zustand) ≥ 24 px. Prompter, Show-Transport, Next Song, Live-Queue, Klick, Visueller Metronom, Tempo-Korrektur, Dashboard-Umschalter, Trigger-Button, Quick Actions, More Me, Lighting Cues, Festival-Uhr, Uhr, Variante & Track, Fußtaster, Stimmgerät.
* **Gig-Blick** - auf der Bühne, aber nur angeschaut oder zwischen Songs bedient: Text ≥ 16 px, Ziele ≥ 48 px. Show-Notizen, Aktive Setlist, System-Status, Geräte-Status, Backup-Status, Sync-Check.
* **Probe** - nur Probe, Üben, Vorbereitung: normale Tablet-Ergonomie (Text ≥ 16 px, Ziele ≥ 44 px), Dichte erlaubt. Loop-Trainer, Quintenzirkel, Akkord-Nachschlagen.
* Die Widget-Bibliothek zeigt die Stufe als Badge und weist bei einem Probe-Widget auf einem auch im Gig verfügbaren Dashboard darauf hin - ohne es zu verbieten.
* Ein Widget, das kleiner als seine Mindestgröße ist, wird im Edit-Modus rot umrandet ("zu klein"). Findet die Bibliothek auf dem Dashboard keinen Platz in voller Standardgröße, fragt sie nach (neues Dashboard mit diesem Widget / trotzdem hinzufügen) statt das Widget stumm zu stauchen - das Raster bleibt fest eine Bildschirmseite.

Der User kann sich seinen Bildschirm aus folgenden Modulen zusammenbauen:

* **Das "Prompter" Widget:** Der Hauptbereich. Zeigt den Text/Akkorde (wahlweise als Scroll oder Paginated).
* **Das "Next Song" Widget (Minimalist):** Eine kleine, flache Leiste (z.B. am oberen Rand). Zeigt nur: `Aktuell: Song A | Next: Song B (120 BPM)`.
* **Das "Live-Queue" Widget (Detail):** Eine Seitenleiste mit der ganzen Setlist. Im Normalfall nur Titel (zum Lesen, was als Nächstes kommt). Der Master-User öffnet per Langdruck auf eine Zeile ein Kontext-Menü ("Als nächstes spielen") und mit "Sortieren" einen Sortier-Modus mit Drag-Handles, der mit "Fertig" oder beim Start der Wiedergabe wieder schließt - so bleiben Bedienelemente nicht auf der Bühne stehen.
* **Das "More Me" IEM Widget:** Eine kleine Kachel mit 2-3 großen Fadern (z.B. "Mein Gesang", "Meine Gitarre", "Band").
* **Das "Show-Transport" Widget (Für Master/Drummer):** Play/Pause/Stop/Reset für den aktuellen Song, mit oder ohne Backing-Track-Plugin - siehe `packages/stage-pwa/src/widgets/ShowTransportWidget.tsx`. Treibt `ShowState.playbackStatus` direkt, damit jedes Tablet dieselbe Uhrzeit und denselben Pause/Stop-Zustand sieht.
* **Das "Quick Action" Grid:** Große Buttons für Ad-Hoc Cues (z.B. "Strobo", "Kaltfunken", "Talkback-Mic").
* **Der "Dashboard-Umschalter":** Große Buttons, die zwischen den Dashboards wechseln (siehe Abschnitt 2). Pro Instanz horizontal oder vertikal.
* **Das "Show-Notizen" Widget:** Live-Notizen von Band und Crew während der Show (z.B. "Gitarre bei diesem Song zu laut"), später im automatisch erfassten Nachbericht ("Nachbericht"-Modus) einsehbar - siehe `packages/shared-types/src/showLog.ts` und `packages/stage-pwa/src/lib/useShowLogTracker.ts`.

**Umgesetzt (#13, 2026-09):** Die früher hier festgehaltene zurückgestellte Idee - ein expliziter Pause/Stop-Zustand statt "Next Song" als einzigem Signal - ist jetzt Realität: `ShowState.playbackStatus` (`playing`/`paused`/`stopped`) plus `playbackAccumulatedMs` tracken die aktive (ungepausete) Spielzeit unabhängig vom Setlist-Fortschritt. Das "Next Song"-Widget (jetzt mit Vor/Zurück) bewegt weiterhin nur die Warteschlangen-Position; das Show-Transport-Widget bewegt davon unabhängig Play/Pause/Stop/Reset für den aktuellen Eintrag. Der Nachbericht zeigt die tatsächliche aktive Spielzeit (`ShowLogEvent`'s `activeMs`), Bandansagen/Nachstimmen zwischendurch zählen nicht mehr mit. Siehe `packages/stage-pwa/src/lib/playbackTransport.ts` und `packages/stage-pwa/src/lib/queue.ts`.

## 4. Responsive Szenarien (Geräte & Orientierung)

### Szenario A: Das Smartphone (6 Zoll, Hochformat)
* **Layout:** Einspaltig (Single Column).
* **Fokus:** Maximaler Platz für den Text.
* **Umsetzung:** Das Prompter Widget füllt 90 % des Bildschirms. Unten gibt es eine kleine Tab-Leiste (Bottom Navigation). Ein Wisch nach links bringt den User sofort zum IEM Widget, ein Wisch nach rechts zur Live-Queue. Keine Splitscreens, da der Platz nicht reicht. *(Idee, nicht gebaut: Tab-Leiste und Wischen gibt es nicht - umgeschaltet wird über ☰ oder den Dashboard-Umschalter. Gebaut ist dafür: ein Dashboard passt auch auf dem Handy immer auf eine Bildschirmseite und scrollt nie, Marco 2026-10-05.)*

### Szenario B: Das Tablet (10-12 Zoll, Hochformat / Portrait)
* **Layout:** Gestapelt (Stacked).
* **Umsetzung:** Oben (10 %): Das minimalistische Next Song Widget. Mitte (80 %): Das Prompter Widget. Unten (10 %): Eine kompakte Leiste mit dem Quick Action Grid und einem Button, der das More Me Fenster als Overlay öffnet. *(Idee, nicht gebaut: More Me ist heute ein normales Widget im Raster, ein Overlay-Modus existiert nicht.)*
* **Wer nutzt das:** Gitarristen, Sänger (klassische Notenständer-Ansicht).

### Szenario C: Das Tablet (10-12 Zoll, Querformat / Landscape)
* **Layout:** Zweispaltig (2-Column Grid).
* **Umsetzung:**
 * Option 1 (Text-Fokus): Links 75 % Prompter, rechts 25 % schmale Live-Queue oder IEM Fader.
 * Option 2 (Mix-Fokus): Links 50 % Prompter, rechts 50 % Show-Transport und IEM Widget.
* **Wer nutzt das:** Keyboarder, Bassisten.

### Szenario D: Der Bühnen-Monitor (24 Zoll, Querformat)
* **Layout:** Dreispaltiges Kommandozentrum (3-Column Dashboard).
* **Umsetzung:** Links 20 % Live-Queue und System-Ampeln, Mitte 50 % Prompter in riesiger Schrift, rechts 30 % IEM-Mischpult und Show-Transport (Play/Pause/Stop).
* **Wer nutzt das:** Der Drummer, der Bandleader oder der FOH/Monitor-Mischer am Bühnenrand.

## 5. Der Edit-Modus (Dashboard-Builder)

Um die Live-Ansicht maximal sicher zu machen, ist das UI während der Show strikt "Read-Only" (kein Verschieben von Elementen möglich).

* **Der Weg in den Edit-Modus (seit #422, 2026-10-07):** Normalerweise schaltet die Dashboard-Liste im Menü (☰ in der Statusleiste) nur um. Alles, was etwas verändert, liegt hinter **einem** Knopf „Bearbeiten“ unter der Liste (vorher: Langdruck auf „Bearbeiten 🔒“ und „Dashboards verwalten“ - beides entfernt). Erst dann tauchen Raster, Begrenzungsrahmen und „+ Widget“ auf (vergleichbar mit Home Assistant).
 * **Umsetzung:** Nach „Bearbeiten“ trägt jede Zeile einen Ziehgriff (Reihenfolge), ein Auge (ausblenden) - beides **nur auf diesem Gerät**, jeder Musiker ordnet sein eigenes Menü - und einen Stift, der das Dashboard im Edit-Modus öffnet; darunter „Neues Dashboard“ (privat für den Anlegenden). Eine geschützte Vorlage (#16) zeigt ein Schloss; ihr Stift bietet „Eigene Kopie bearbeiten“ an. Im Edit-Modus ersetzt die Edit-Leiste die Statusleiste: Name (antippen = umbenennen), „+ Widget“, „⋯“ (Dashboard-Einstellungen: Anbieten in Gig/Solo, Sichtbar für, Statusleiste anzeigen, Als Vorlage schützen, Duplizieren, Löschen, Alle zurücksetzen) und „🔒 Fertig“. Der ganze Widget-Körper ist der Griff zum Verschieben, alle acht Ränder skalieren, jedes Widget trägt ein Namensschild und ein „⋯“-Menü (Einstellungen, Rahmen ein/aus, Entfernen); Widgets unter ihrer Mindestgröße sind rot umrandet („zu klein“). Der Edit-Modus wird bewusst **nicht** gespeichert — nach jedem Reload ist das UI wieder gesperrt, damit eine vergessene Edit-Session nicht auf der Bühne zur Fehlbedienung wird.
* **Dynamische Widget-Bibliothek (Plugin-Aware):** Das Hinzufügen-Menü zeigt nur die Widgets an, für die die Band auch die passenden Plugins installiert hat.
 * Beispiel: Nutzt die Band keinen digitalen Mixer (Plugin nicht installiert oder deaktiviert), taucht das "IEM / More Me"-Widget in der UI-Bibliothek gar nicht erst auf. Das hält die App für simple Setups extrem schlank und übersichtlich.
 * **Nicht** aus der Bibliothek fliegt ein Widget, dessen Plugin zwar installiert, dessen Hardware aber gerade nicht erreichbar ist — der Unterschied ist genau der aus Abschnitt 7.

## 6. Fallback & Offline-Zustände (Graceful Degradation)

Was passiert, wenn ein Musiker ein "IEM Widget" in seiner Station konfiguriert hat, die Band heute aber über ein analoges Festival-Pult spielt (Venue-Profil ohne Netzwerk-Mixer)?

* **Erhalt des Muskelgedächtnisses:** Das Widget verschwindet nicht aus dem Layout. Würde es verschwinden, würden andere Widgets nachrücken und das gewohnte Layout zerstören, was im Live-Stress zu Fehlbedienungen führt.
* **Disabled State:** Das betroffene Widget bleibt an seinem Platz, wird jedoch ausgegraut (50 % Transparenz) und zeigt ein eindeutiges Icon (z.B. durchgestrichenes Signal oder Offline). Drückt der User darauf, passiert nichts, um den Workflow nicht zu stören.
* **Wann genau:** Der Disabled State greift bei Capability-Status `degraded` (Plugin installiert, aber nicht erreichbar), nie bei `missing` — siehe Abschnitt 7.

## 7. Plugins & Capabilities (der Vertrag zwischen UI und Hardware)

Widgets kennen keine Geräte, sondern **Capabilities** — `mixer`, `lighting`, `show-control`, `midi-input`, `audio-playback`, `backup`. Ein Plugin sagt, welche es mitbringt; ein Widget sagt, welche es braucht. Damit ist das UI erweiterbar, ohne dass die Core-App neue Hardware kennen muss.

Entscheidend sind zwei **verschiedene** Fragen, die im UI unterschiedlich wirken:

| Frage | Woher | Wirkung |
| :--- | :--- | :--- |
| **Installiert?** Hat die Band dieses Plugin überhaupt? | Repliziertes Installations-Dokument — auf einem Tablet installiert, verteilt es sich über das Bühnen-Netz (siehe [docs/01](01_Architektur_Spezifikation.md)) | Widget steht in der Bibliothek — oder existiert für diese Band gar nicht |
| **Erreichbar?** Antwortet die Hardware *heute, an diesem Ort*? | Heartbeat des hostenden Geräts — Stage-Server-Plugins per Push-Kanal (SSE), Client-Plugins (WebMIDI) per lokaler Prüfung auf dem Tablet, zusätzlich an die anderen Tablets gemeldet | Widget bleibt im Layout, geht aber in den Disabled State (Abschnitt 6) |

* **Nicht jedes Plugin läuft auf dem Stage-Server.** Manche Hardware (z. B. ein Bluetooth-Fußtaster) ist von der niedrigsten Ausbaustufe an tablet-gehostet (siehe [docs/02](02_Ausbaustufen_Konzept.md)) — Erreichbarkeit kann also vom Stage-Server *oder* von einem Tablet ausgehen. Beide Quellen laufen über denselben Weg zusammen: der Stage-Server hält den aktuellen Zustand pro Band im Speicher und verteilt ihn per Server-Sent Events an jedes verbundene Tablet; ein Tablet meldet den Zustand seines eigenen Client-Plugins per einfachem POST. Kein CouchDB-Umweg mehr — ein Heartbeat hat keinen Offline-/Multi-Master-Wert, den eine synchronisierte Datenbank bieten müsste, und die alte Lösung hat den Sync-Status-Indikator verfälscht.
* **Kein Heartbeat = offline.** Stirbt die Quelle (Stage-Server oder das hostende Tablet), schreibt niemand mehr "offline" — ein veralteter Heartbeat (älter als 15 s) zählt deshalb selbst als Ausfall. Die Tablets grauen die betroffenen Widgets von allein aus, ohne Reload.
* **Deaktivieren statt deinstallieren:** Ein deaktiviertes Plugin zählt wie "nicht installiert" — seine Widgets verschwinden aus der Bibliothek und der Stage-Server fährt das Plugin herunter. Das ist der schnelle Weg, ein Venue ohne Netzwerk-Mixer zu fahren, ohne die Konfiguration zu verlieren.

### Welches Widget braucht was

| Widget | Braucht |
| :--- | :--- |
| Prompter, Next Song, Show-Transport, Dashboard-Umschalter | — (Core, graut nie aus) |
| Fußtaster-Status | `midi-input` |
| More Me (IEM) | `mixer` |
| Quick Actions | `show-control` |
