# Editor & Datenstruktur: Das "Song-Studio"

Um die Komplexität von Texten, Akkorden und Zeitsteuerungen (MIDI/Licht) beherrschbar zu machen, ist der Editor in der App modular in mehrere Ansichten unterteilt, die sich die Band per Plugin zusammenstellen kann.

## 1. Das Fundament: Der ChordPro-Standard
Unter der Haube speichert die App jeden Song im ChordPro-Format (ein Open-Source-Standard), angereichert mit Time-Tags. 

* **Beispiel:** `[01:14.50] I shot the [G] Sheriff, but I didn't shoot the [C] deputy.`
* **Warum?** Es ist winzig klein, zukunftssicher und erlaubt es der App, Akkorde auf Knopfdruck zu transponieren (z. B. von G-Dur nach A-Dur) oder Capo-Einstellungen zu berechnen.

## 2. Tab 1: Der "Sheet Editor" (Text & Akkorde)
Der Musiker soll beim Eintragen keinen Code schreiben müssen. Die UI bietet einen WYSIWYG (What You See Is What You Get) Editor.

* **Smart Import:** Der User kopiert einen Text von Ultimate Guitar (wo die Akkorde einfach über dem Text stehen) und fügt ihn ein. Die App erkennt per Regex (Mustererkennung) automatisch die Struktur und wandelt es unsichtbar in sauberes ChordPro um.
* **Inline-Editing:** Will der User einen Akkord hinzufügen, klickt er einfach auf ein Wort. Es poppt ein kleines Fenster auf (wie bei einem Kommentar in Google Docs), in das er z.B. "Am" tippt. Die App platziert den Akkord visuell exakt über dem Wort.
* **Song-Parts definieren:** Mit großen Buttons am Rand kann der User Textblöcke markieren und ihnen Labels zuweisen (z.B. "Verse 1", "Chorus", "Bridge", "Solo"). Diese Blöcke bekommen dadurch automatisch eine visuelle Klammer und eine Farbe.
 * **Syntax:** Ein Part beginnt mit einer eigenen Direktiven-Zeile `{part: Chorus}` und läuft bis zum nächsten `{part: ...}` (oder bis zu einem `{end_of_part}`). Die ChordPro-Standard-Direktiven `{soc}` / `{start_of_chorus: ...}` (analog `sov`/`sob` und die `end_of_*`-Gegenstücke) werden ebenfalls verstanden, damit importierte Fremddateien nicht umgeschrieben werden müssen. Unbekannte Direktiven (z.B. `{title: ...}`) bleiben unangetastet und werden als normaler Text gerendert.
 * **Wirkung:** Die Parts sind gleichzeitig die Seiten-Grenzen der "Paginated View" (siehe [docs/07](07_UI_Konzept.md)) und werden von Tap-to-Sync übersprungen — eine Label-Zeile bekommt keinen Timecode.

## 3. Tab 2: Die Timecode-Generierung (Plugin-basiert)
Um den Texten, Akkorden und Cues eine Zeitachse zuzuweisen, gibt es zwei verschiedene Workflows (als Plugins wählbar), um dem Arbeitsstil jedes Musikers gerecht zu werden.

### Workflow A: "Tap-to-Sync & Live Record" (Der Trockenlauf)
Perfekt für die schnelle, intuitive Erstellung - nicht nur für den Text, sondern für die komplette Show!

* **Text & Akkorde:** Der Musiker startet das Audio-Playback (oder einen Klick-Track). Der Text läuft durch. Passend zum Start jeder Textzeile drückt er einfach die Leertaste.
* **Licht & Effekte (Show Automation):** Der Gitarrist oder Lichttechniker "spielt" die Show im Trockenlauf einfach mit. Drückt der Gitarrist bei Minute 1:15 seinen MIDI-Fußschalter für den Solo-Sound, oder triggert der Licht-Mensch den Stroboskop-Button, zeichnet die App diesen Befehl in Echtzeit auf.
* **Die Magie:** Die App setzt im Hintergrund automatisch die exakten Timecode-Stempel für Text, MIDI- und OSC-Cues (z. B. `[01:15.22] MIDI: PC5`). Ein 4-Minuten-Song ist so in exakt 4 Minuten komplett als vollautomatisierte Show programmiert.

### Workflow B: "Die Timeline" (Drag & Drop)
Perfekt für das visuelle Feintuning und manuelle Anpassungen. Dieser Bereich sieht aus wie eine abgerüstete DAW (z.B. Ableton Live).

* **Der Zeitstrahl:** Gibt es ein Backing-Track/Audio-Playback, wird hier die Audio-Wellenform angezeigt.
* **Drag & Drop Marker:** Die im Sheet Editor definierten Song-Parts oder im Trockenlauf erstellten Timecodes tauchen hier als Blöcke auf und können mit der Maus feinjustiert (verschoben) werden.
* **Die Cues-Spur (MIDI / Licht):** Unter dem Text-Zeitstrahl gibt es eine Spur für "Aktionen". Hier können Befehle auch ohne Trockenlauf manuell per Klick gezeichnet werden.

## 4. Fallback: Der "No-Timecode" Modus
Nicht jede Band spielt strikt nach Klick oder Timecode. Gibt es keinen Timecode, verknüpfen sich die Cues und Marker nicht mit einer festen Uhrzeit, sondern mit dem Blättern.

* Tritt der Musiker auf seinen Bluetooth-Fußtaster, springt das Tablet von "Verse 1" zu "Chorus". 
* Der MIDI-Befehl (z.B. Kemper Solo-Sound) oder der DMX-Licht-Cue wird in diesem Moment durch das Umblättern getriggert, nicht durch die Uhrzeit. 
* So funktioniert die Show-Automation (Licht & Sound) auch bei 100% manuell gespielten Gigs, deren Tempo jeden Abend variiert.