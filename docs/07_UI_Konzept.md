# UI/UX Konzept: Das modulare Bühnen-Interface

Um alle Geräte vom 6-Zoll-Smartphone bis zum 24-Zoll-Monitor zu bedienen, nutzt die PWA ein Widget-basiertes Layout-System.

## 1. Die Grundphilosophie

* **Dark Mode & Light Mode Toggle:** Auf der Bühne ist der Dark Mode (reines OLED-Schwarz, `#000000` kombiniert mit hochkontrastigen Farben) der unverrückbare Standard, damit nichts blendet und die Augen nicht ermüden. Für die Vorbereitung unterwegs (z.B. im Zug, bei Tageslicht oder auf der Terrasse) gibt es einen gestochen scharfen Light Mode (schwarze Schrift auf reinweißem oder leicht mattem Hintergrund), um Reflexionen auf dem Display zu kontern.
* **Touch-First & "Fat Finger" Design:** Keine winzigen Dropdowns im Live-Modus. Alle aktiven Schaltflächen (Next Song, More Me, Panic Button) sind riesig, damit man sie notfalls auch schweißgebadet oder aus dem Augenwinkel trifft.
* **Intelligente & gerätespezifische Profile ("Stations"):** Um Musiker nicht zu überfordern, ordnet ein intelligentes Raster die Widgets standardmäßig anhand der Bildschirmgröße und Drehung automatisch an (Responsive Default). Profis können jedoch gerätespezifische Setups ("Stations") in ihrem Profil speichern. So hat der Sänger am vorderen Mikrofon-Tablet (Hochformat) nur Text, während er am Keyboard-Tablet (Querformat) sein "More Me"-Widget sieht. Die App merkt sich pro Endgerät, welche Station zuletzt geladen war.
 * **Umsetzungsstand:** Der geteilte Teil ist als **Dashboards** umgesetzt (siehe Abschnitt 2) — jedes Dashboard bringt pro Bildschirmklasse ein eigenes Raster mit, und jedes Endgerät merkt sich, welches Dashboard es zuletzt zeigte. Vollständig *persönliche* Dashboard-Sets pro Gerät ("Stations" im engeren Sinn) bauen darauf auf und sind noch offen.

## 2. Dashboards & Navigation

Ein Bildschirm reicht nicht: der Prompter, das Monitoring-Cockpit und die Lichtsteuerung wollen jeweils den ganzen Platz. StageBoard kennt deshalb beliebig viele **Dashboards** — benannte, frei konfigurierbare Seiten (z.B. "Prompter", "Monitoring", "Light").

* **Ein Dashboard ist eine Seite mit eigenem Raster.** Anlegen, umbenennen, duplizieren, löschen und sortieren passiert im Edit-Modus (Abschnitt 5). Das letzte Dashboard lässt sich nicht löschen — ein Gerät ohne Dashboard hätte nichts anzuzeigen.
* **Ein Dashboard bedient alle Gerätegrößen.** Statt pro Gerät zu existieren, hält es je Bildschirmklasse (`sm`/`md`/`lg`/`xl`, siehe die Szenarien in Abschnitt 4) ein eigenes Raster. Wer das Layout am Bühnen-Monitor umbaut, zerstört damit nicht die Tablet-Ansicht.
* **Umgeschaltet wird über ein Widget**, nicht über eine feste Leiste: das "Dashboard-Umschalter"-Widget rendert große Buttons (horizontal als Leiste oder vertikal als Spalte, pro Instanz einstellbar) und liegt selbst im Raster. So entscheidet jeder Bildschirm, wo seine Navigation sitzt — oder ob er überhaupt eine braucht.
* **Geteilt, aber lokal ausgewählt:** Dashboards replizieren band-weit wie Setlisten. Der Bandleader baut "Light" einmal, der Lichtmensch wählt es auf seinem Tablet aus. *Welches* Dashboard offen ist, bleibt eine reine Geräte-Einstellung und überlebt den Reload.

## 3. Die UI-Bausteine (Widgets)

Der User kann sich seinen Bildschirm aus folgenden Modulen zusammenbauen:

* **Das "Prompter" Widget:** Der Hauptbereich. Zeigt den Text/Akkorde (wahlweise als Scroll oder Paginated).
* **Das "Next Song" Widget (Minimalist):** Eine kleine, flache Leiste (z.B. am oberen Rand). Zeigt nur: `Aktuell: Song A | Next: Song B (120 BPM)`.
* **Das "Live-Queue" Widget (Detail):** Eine Seitenleiste. Zeigt die nächsten 5-10 Songs. Der Master-User hat hier Wisch-Gesten oder Kontext-Menüs ("Als nächstes spielen"), um die Reihenfolge spontan zu ändern.
* **Das "More Me" IEM Widget:** Eine kleine Kachel mit 2-3 großen Fadern (z.B. "Mein Gesang", "Meine Gitarre", "Band").
* **Das "Show Cockpit" (Für Master/Drummer):** Große Stoppuhr, Timecode, visuelles Metronom (Blinken), System-Status-Ampel.
* **Das "Quick Action" Grid:** Große Buttons für Ad-Hoc Cues (z.B. "Strobo", "Kaltfunken", "Talkback-Mic").
* **Der "Dashboard-Umschalter":** Große Buttons, die zwischen den Dashboards wechseln (siehe Abschnitt 2). Pro Instanz horizontal oder vertikal.
* **Das "Show-Notizen" Widget:** Live-Notizen von Band und Crew während der Show (z.B. "Gitarre bei diesem Song zu laut"), später im automatisch erfassten Nachbericht ("Nachbericht"-Modus) einsehbar - siehe `packages/shared-types/src/showLog.ts` und `packages/stage-pwa/src/lib/useShowLogTracker.ts`.

**Zurückgestellte Idee - explizite Pause/Stop-Kontrolle:** Der Show Cockpit hat aktuell nur Start/Stop/Reset für die Stoppuhr, keine Möglichkeit, "gerade spielt kein Song" als eigenen Zustand festzuhalten - `ShowState.activeSongId` kennt nur "welcher Song ist gerade aktiv", keinen Leerzustand. Der Nachbericht kann deshalb Pausen zwischen Songs (Bandansage, Nachstimmen) nicht von der Spielzeit des vorherigen Songs unterscheiden - beides ist bis auf Weiteres derselbe Zeitpunkt: der nächste Tap auf "Next Song". Eine echte Lösung bräuchte einen expliziten Pause/Stop-Button neben "Next Song", der `activeSongId` bewusst auf "nichts spielt gerade" setzt - das würde auch computeQueue.ts's Vorstellung von "aktueller Song" berühren, nicht nur das Logging. Bewusst zurückgestellt (2026), aber hier festgehalten, damit die Idee nicht verloren geht.

## 4. Responsive Szenarien (Geräte & Orientierung)

### Szenario A: Das Smartphone (6 Zoll, Hochformat)
* **Layout:** Einspaltig (Single Column).
* **Fokus:** Maximaler Platz für den Text.
* **Umsetzung:** Das Prompter Widget füllt 90 % des Bildschirms. Unten gibt es eine kleine Tab-Leiste (Bottom Navigation). Ein Wisch nach links bringt den User sofort zum IEM Widget, ein Wisch nach rechts zur Live-Queue. Keine Splitscreens, da der Platz nicht reicht.

### Szenario B: Das Tablet (10-12 Zoll, Hochformat / Portrait)
* **Layout:** Gestapelt (Stacked).
* **Umsetzung:** Oben (10 %): Das minimalistische Next Song Widget. Mitte (80 %): Das Prompter Widget. Unten (10 %): Eine kompakte Leiste mit dem Quick Action Grid und einem Button, der das More Me Fenster als Overlay öffnet.
* **Wer nutzt das:** Gitarristen, Sänger (klassische Notenständer-Ansicht).

### Szenario C: Das Tablet (10-12 Zoll, Querformat / Landscape)
* **Layout:** Zweispaltig (2-Column Grid).
* **Umsetzung:**
 * Option 1 (Text-Fokus): Links 75 % Prompter, rechts 25 % schmale Live-Queue oder IEM Fader.
 * Option 2 (Mix-Fokus): Links 50 % Prompter, rechts 50 % Show Cockpit und IEM Widget.
* **Wer nutzt das:** Keyboarder, Bassisten.

### Szenario D: Der Bühnen-Monitor (24 Zoll, Querformat)
* **Layout:** Dreispaltiges Kommandozentrum (3-Column Dashboard).
* **Umsetzung:** Links 20 % Live-Queue und System-Ampeln, Mitte 50 % Prompter in riesiger Schrift, rechts 30 % IEM-Mischpult und Show Cockpit (Timecode, Metronom).
* **Wer nutzt das:** Der Drummer, der Bandleader oder der FOH/Monitor-Mischer am Bühnenrand.

## 5. Der Edit-Modus (Dashboard-Builder)

Um die Live-Ansicht maximal sicher zu machen, ist das UI während der Show strikt "Read-Only" (kein Verschieben von Elementen möglich).

* **Der "Edit-Lock":** Um Dashboards anzupassen, muss ein versteckter Schalter (oder "Long Press" auf ein Settings-Icon) betätigt werden. Erst dann tauchen Raster, Begrenzungsrahmen und ein "Plus"-Button auf (vergleichbar mit Home Assistant).
 * **Umsetzung:** Long Press (600 ms) auf das Schloss-Icon. Der Edit-Modus wird bewusst **nicht** gespeichert — nach jedem Reload ist das UI wieder gesperrt, damit eine vergessene Edit-Session nicht auf der Bühne zur Fehlbedienung wird. Im Edit-Modus bekommt jedes Widget eine Titelleiste (Griff zum Verschieben, Zahnrad für die Widget-Einstellungen, ✕ zum Entfernen) und eine Anfasser-Ecke zum Skalieren.
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
| **Erreichbar?** Antwortet die Hardware *heute, an diesem Ort*? | Heartbeat, den der Stage-Server schreibt; bei Client-Plugins (WebMIDI) eine lokale Prüfung auf dem Tablet | Widget bleibt im Layout, geht aber in den Disabled State (Abschnitt 6) |

* **Kein Heartbeat = offline.** Fällt der Stage-Server aus, schreibt niemand mehr "offline" — ein veralteter Heartbeat (älter als 15 s) zählt deshalb selbst als Ausfall. Die Tablets grauen die betroffenen Widgets von allein aus, ohne Reload.
* **Deaktivieren statt deinstallieren:** Ein deaktiviertes Plugin zählt wie "nicht installiert" — seine Widgets verschwinden aus der Bibliothek und der Stage-Server fährt das Plugin herunter. Das ist der schnelle Weg, ein Venue ohne Netzwerk-Mixer zu fahren, ohne die Konfiguration zu verlieren.

### Welches Widget braucht was

| Widget | Braucht |
| :--- | :--- |
| Prompter, Next Song, Show Cockpit, Dashboard-Umschalter | — (Core, graut nie aus) |
| Fußtaster-Status | `midi-input` |
| More Me (IEM) | `mixer` |
| Quick Actions | `show-control` |
