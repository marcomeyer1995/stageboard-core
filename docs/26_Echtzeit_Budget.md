# Echtzeit-Budget: Audio und Bild zuerst, alles andere in freier Zeit

Konzept, Stand 2026-10-28, mit Marco besprochen am 2026-10-28. Schritt 1 (Posteingang) wird gebaut; Schritte 2 und 3 folgen.

## 1. Anlass

Die Timeline ruckelte auf dem Redmi alle 5 Sekunden. Gemessen (Long-Animation-Frame-API über CDP): ein Frame von 80-100 ms, darin **7 Server-Nachrichten** des Plugin-Status-Streams, je ~10 ms, weil jede alles neu zeichnete, was einen Plugin-Status zeigt. Der Stage-Server schickt den vollen Stand einmal je Plugin-Heartbeat - 7 Plugins, 7 Nachrichten am Stück.

Davor am 2026-10-27 dasselbe Muster aus anderer Quelle: beim Nachholen nach einer Nacht offline lasen alle Stores bei jeder replizierten Änderung ihre Sammlung neu (#648).

Marcos Grundsatz (2026-10-28): **Man weiß nie, was ein Produzent schickt.** Die App selbst muss dafür sorgen, dass Audio und Bild immer zuerst bedient werden, und Zusätzliches nur in freier Zeit erledigen.

## 2. Was der Browser hergibt (Grenzen)

- **Keine harte Echtzeit:** JavaScript läuft auf einem Thread, eine begonnene Aufgabe läuft zu Ende. Eine Zeitscheibe lässt sich nicht garantieren, nur sehr nahe kommen.
- **Audio läuft schon eigenständig:** Web-Audio-Track und Klick werden vorausgeplant und spielen auf dem Audio-Thread des Browsers; das `<audio>`-Element ganz für sich. Der Haupt-Thread stört nur, wenn er länger blockiert als der Vorlauf (heute: Klick 150 ms, MIDI-Clock 200 ms, Ansagen 150 ms, Cues mit eigenem Vorlauf).
- **Der Compositor ist frei:** CSS-Animationen von `transform`/`opacity` laufen auf dem Grafik-Thread weiter, auch wenn JavaScript 100 ms blockiert.
- **React mit externen Stores** (Zustand, `useSyncExternalStore`) rendert synchron - `startTransition` hilft dort nicht. Die Entlastung muss **vor** dem Store passieren.

## 3. Drei Bausteine

### 3.1 Posteingang (Schritt 1)

Jeder Push-Kanal (Server-Streams; später auch Datenbank-Änderungen) legt nur den **neuesten Stand** in einen Posteingang - Mikrosekunden. Je Kanal gilt „der neueste gewinnt“: 7 Nachrichten werden eine.

Zwei Klassen:

| Klasse | Kanäle | Wann angewendet |
|---|---|---|
| **sofort** | Show-State-Push (Play/Stop, Sprünge), Schalter, Geräte-Trigger, OSC-Eingang | sofort - ihr Timing ist die Funktion |
| **Hintergrund** | Plugin-Status, Anwesenheit, Discovery | in freier Zeit zwischen Frames (Idle-Callback mit Zeitbudget), spätestens nach ~1 s |

Dazu ein **Long-Frame-Monitor** im Entwickler-Build: meldet jeden Frame über 50 ms mit Ursache (Skript, Stil/Layout, Zeichnen) in der Konsole - dieselbe Messung wie bei der Untersuchung.

### 3.2 Bewegtes Bild auf dem Grafik-Thread (Schritt 2)

Playhead und mitlaufendes Scrollen (Timeline, Prompter) als CSS-Animation mit bekannter Geschwindigkeit (Tempo × Rate); der Haupt-Thread korrigiert nur gelegentlich die Lage. Timeline-Leinwände werden breiter als sichtbar vorgezeichnet und nur verschoben, statt alle paar Sekunden alles neu zu zeichnen (heute ~100 ms je Seitenwechsel).

### 3.3 Audio-Vorlauf (Schritt 3)

Vorläufe messen und so groß machen, dass ein realistischer Haupt-Thread-Stau (GC, ein langer Frame) sie nie aufbraucht - einige hundert statt ~150 ms. Dekodieren bleibt außerhalb des Haupt-Threads. Berührt die Audio-Wege: nur mit Hörtest.

## 4. Reihenfolge

1. Posteingang + Long-Frame-Monitor (größter Gewinn, kleinstes Risiko, wirkt auf alle Kanäle).
2. Playhead/Scrollen auf dem Grafik-Thread.
3. Audio-Vorläufe messen und anpassen.

Die Erzeuger-Seite (Stage-Server schickt einen Stand je Runde statt je Plugin) bleibt sinnvoll, ist aber nicht mehr nötig.

## 5. Offen

- Datenbank-Änderungen (Stores, #648) auch über den Posteingang - mit Klassen je Sammlung?
- Budget je Idle-Scheibe und Höchstverzögerung je Kanal: 1 s als Start, nach Messung anpassen.
- Ob der Long-Frame-Monitor auch im Release-Build (still, nur in den Diagnose-Bericht) mitlaufen soll.
