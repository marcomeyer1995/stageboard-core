# UI/UX Konzept: Das modulare Bühnen-Interface

Um alle Geräte vom 6-Zoll-Smartphone bis zum 24-Zoll-Monitor zu bedienen, nutzt die PWA ein Widget-basiertes Layout-System.

## 1. Die Grundphilosophie

* **Dark Mode & Light Mode Toggle:** Auf der Bühne ist der Dark Mode (reines OLED-Schwarz, `#000000` kombiniert mit hochkontrastigen Farben) der unverrückbare Standard, damit nichts blendet und die Augen nicht ermüden. Für die Vorbereitung unterwegs (z.B. im Zug, bei Tageslicht oder auf der Terrasse) gibt es einen gestochen scharfen Light Mode (schwarze Schrift auf reinweißem oder leicht mattem Hintergrund), um Reflexionen auf dem Display zu kontern.
* **Touch-First & "Fat Finger" Design:** Keine winzigen Dropdowns im Live-Modus. Alle aktiven Schaltflächen (Next Song, More Me, Panic Button) sind riesig, damit man sie notfalls auch schweißgebadet oder aus dem Augenwinkel trifft.
* **Intelligente & gerätespezifische Profile ("Stations"):** Um Musiker nicht zu überfordern, ordnet ein intelligentes Raster die Widgets standardmäßig anhand der Bildschirmgröße und Drehung automatisch an (Responsive Default). Profis können jedoch gerätespezifische Setups ("Stations") in ihrem Profil speichern. So hat der Sänger am vorderen Mikrofon-Tablet (Hochformat) nur Text, während er am Keyboard-Tablet (Querformat) sein "More Me"-Widget sieht. Die App merkt sich pro Endgerät, welche Station zuletzt geladen war.

## 2. Die UI-Bausteine (Widgets)

Der User kann sich seinen Bildschirm aus folgenden Modulen zusammenbauen:

* **Das "Prompter" Widget:** Der Hauptbereich. Zeigt den Text/Akkorde (wahlweise als Scroll oder Paginated).
* **Das "Next Song" Widget (Minimalist):** Eine kleine, flache Leiste (z.B. am oberen Rand). Zeigt nur: `Aktuell: Song A | Next: Song B (120 BPM)`.
* **Das "Live-Queue" Widget (Detail):** Eine Seitenleiste. Zeigt die nächsten 5-10 Songs. Der Master-User hat hier Wisch-Gesten oder Kontext-Menüs ("Als nächstes spielen"), um die Reihenfolge spontan zu ändern.
* **Das "More Me" IEM Widget:** Eine kleine Kachel mit 2-3 großen Fadern (z.B. "Mein Gesang", "Meine Gitarre", "Band").
* **Das "Show Cockpit" (Für Master/Drummer):** Große Stoppuhr, Timecode, visuelles Metronom (Blinken), System-Status-Ampel.
* **Das "Quick Action" Grid:** Große Buttons für Ad-Hoc Cues (z.B. "Strobo", "Kaltfunken", "Talkback-Mic").

## 3. Responsive Szenarien (Geräte & Orientierung)

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

## 4. Der Edit-Modus (Dashboard-Builder)

Um die Live-Ansicht maximal sicher zu machen, ist das UI während der Show strikt "Read-Only" (kein Verschieben von Elementen möglich).

* **Der "Edit-Lock":** Um Dashboards anzupassen, muss ein versteckter Schalter (oder "Long Press" auf ein Settings-Icon) betätigt werden. Erst dann tauchen Raster, Begrenzungsrahmen und ein "Plus"-Button auf (vergleichbar mit Home Assistant).
* **Dynamische Widget-Bibliothek (Plugin-Aware):** Das Hinzufügen-Menü zeigt nur die Widgets an, für die der Stage-Server auch die passenden Plugins geladen hat.
 * Beispiel: Nutzt die Band keinen digitalen Mixer (Plugin inaktiv), taucht das "IEM / More Me"-Widget in der UI-Bibliothek gar nicht erst auf. Das hält die App für simple Setups extrem schlank und übersichtlich.

## 5. Fallback & Offline-Zustände (Graceful Degradation)

Was passiert, wenn ein Musiker ein "IEM Widget" in seiner Station konfiguriert hat, die Band heute aber über ein analoges Festival-Pult spielt (Venue-Profil ohne Netzwerk-Mixer)?

* **Erhalt des Muskelgedächtnisses:** Das Widget verschwindet nicht aus dem Layout. Würde es verschwinden, würden andere Widgets nachrücken und das gewohnte Layout zerstören, was im Live-Stress zu Fehlbedienungen führt.
* **Disabled State:** Das betroffene Widget bleibt an seinem Platz, wird jedoch ausgegraut (50 % Transparenz) und zeigt ein eindeutiges Icon (z.B. durchgestrichenes Signal oder Offline). Drückt der User darauf, passiert nichts, um den Workflow nicht zu stören.