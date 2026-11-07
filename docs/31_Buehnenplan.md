# 31 Bühnenplan – die Bühne als ein Bild (Konzept)

Stand 2026-11-06, Konzept mit Marcos Entscheidungen (§0, §0a: Karte, Anschlüsse, Karte als Master). Anlass: beim Abgleich nach Gehör (PR #700) war der Weg Geräte → ⋯ → Latenz… → Abgleich zu verschachtelt; Marco: Abgleich gehört in einen späteren Bühnenplan mit sichtbarer Aufstellung, und der kann den Ablauf des Einmessens ändern – darum erst dieses Konzept, dann die automatische Einmess-Runde.

Berührt drei Ideen, die dieselben Daten zeigen: **#62** (räumliche Bühnenmatrix), **#488** (Stage Plot und Input-Liste als PDF) und **docs/21 §4 / docs/30** (Ausgabewege mit Latenz, Abgleich, Einmessen). Dieser Bühnenplan nimmt nur die dritte auf; #62 und #488 bleiben eigene Themen (§0).

## 0. Entscheidungen (Marco, 2026-11-05)

| Frage | Entscheidung |
|---|---|
| Ort | **ersetzt den Tab „Bühnentechnik“** in System, **Name „Bühne“** (Rollen, Logical Devices, dazu Wege und Einmessen); „Tablets & Handys“ bleibt Diagnose |
| Korrektur | **jeder physische Weg, der Ausgleich braucht, hat genau eine Latenz-Korrektur** – nicht je Hörort; ein Weg, den mehrere Hörorte hören, hat einen Wert |
| Eigenes Gerät | **das eigene Tablet ist in der Übersicht hervorgehoben** – wie in „Band“ und bei den Bandmitgliedern |
| Umfang | **Wege und Einmessen**; #62 (Matrix per Ziehen) und #488 (Plot/PDF) bleiben getrennt |
| Zuerst | **Liste der Wege** (je Gerät, Zustand, einmessen) – die Karte später auf denselben Daten |
| Wer bearbeitet | **jeder seinen eigenen Platz** (eigene Position, eigener Hörweg, die eigenen Geräte); alles andere der Admin |
| Hörorte | **keine eigenen Daten** (Marco: unklar, und mit einer Korrektur je Weg ohne Zweck) – die Liste ist **nach Gerät** gruppiert, jeder Weg zeigt, **wer ihn nutzt** („Klick → Kai, In-Ear“); beim Abgleich nur ein Hinweis, wo man stehen sollte |
| Maße | **nur schematisch** – keine Meter, keine Startwerte aus Abständen |
| Varianten | **mehrere Aufbauten je Band** (Proberaum/Club/Festival), **im Gig von Hand gewählt** (der Master, wie die Setlist); Messwerte gehören zum Weg und gelten in jeder Variante |
| Ohne Profil | **nur ansehen** – wer kein Profil gewählt hat, bearbeitet in „Bühne“ nichts |

## 0a. Entscheidungen (Marco, 2026-11-06) – Karte, Anschlüsse, Karte als Master

Anlass: die gebaute Wege-Liste (PR #705) war Marco zu wenig – er will die **dynamische Karte** jetzt, auf der man die Geräte so verbindet wie auf der Bühne. Klickbares Mockup: https://claude.ai/artifact/Q65gXy2yKuz2PU4cmvaZSG (Vollbild mit Verschieben/Zoomen fürs Handy, Anschlüsse, Beispiele Proberaum/Club/Neue Band).

| Frage | Entscheidung |
|---|---|
| Karte | **jetzt bauen** (statt Schritt 4); die Liste bleibt als zweite Ansicht derselben Daten und als Start auf dem Handy; Karte im **Vollbild** mit Verschieben/Zoomen bis „Ganze Bühne“ |
| Anschlüsse | jedes Gerät zeigt seine **Anschlüsse** je nach Fähigkeit (Kemper: DIN-MIDI oder USB-MIDI; Pult: Eingänge, USB-Audio …); verbunden wird **Anschluss mit Anschluss** (§7) |
| Karte als Master | **die Karte konfiguriert** – sie ist die eine Stelle, die entscheidet, wo ein virtueller Anschluss physisch herauskommt (Gerät, Anschluss, MIDI-Port des Plugins) und welche Latenzwerte gelten; keine zweite Stelle, die widersprechen kann |
| Logical Devices | **bleiben** – als **virtuelle Anschlüsse** von StageBoard („Kemper“, „Licht“, „Klick“ …), die Songs, Cues, Widgets und Auslöser ansprechen; die Karte ist das **Soft-Patching** je Aufbau auf physische Anschlüsse (wie am Digitalpult); der feste Zielort (`executionTarget`) und die eigene Port-Einstellung im Plugin fallen weg (Marcos Idee, §7a) |
| Klick/Track/Ansagen | **gewöhnliche virtuelle Ausgänge** – umbenennen und verdoppeln möglich („Klick Drums“ mit Einzähler, „Klick Band“ ohne) |
| Regeln | **locker**: Signal und Richtung müssen passen, ein anderer Stecker nur Warnung („Adapter nötig“); streng (Kabelplanung) vielleicht später |
| Eigene Modelle | **nur der Admin** legt Ausrüstung und Band-Modelle an |
| Umfang Anschlüsse | am Ende **jeder physische Anschluss**, aber **optional**: eine Band legt nur an, was sie nutzt |
| Umstieg | **leer anfangen, alte Verbindungs-Einstellungen entfallen** (wie beim starren Raster) |
| Standard | statt unsichtbarem Verhalten eine **Standard-Karte**: hat eine Band keine, erzeugt die App sie aus den bekannten Geräten – **jedes Gerät spielt Klick, Track und Ansagen über den eigenen Lautsprecher für den, der darauf angemeldet ist**, **unabhängig vom Master** (ersetzt die heutige Gig-Regel „der Master spielt“); neue Geräte kommen genauso dazu; danach gewöhnliche Daten, von Hand korrigiert |

## 0b. Entscheidungen (Marco, 2026-11-07) – nach dem ersten Test der Karte auf den Geräten

| Frage | Entscheidung |
|---|---|
| Anschlüsse ohne Plugin-Modell | **„Anschlüsse“** an jeder Ausrüstung (nur Admin) als **freie Liste**: je Zeile Name, Richtung, Stecker (XLR, Kombi, Klinke TRS, **Klinke mono TS** – die Aux des CQ-18T –, 3,5 mm, Cinch, USB-A/B/C, RJ45, MIDI DIN, DMX, Funk, Schall), Anzahl, Signal; Vorlage aus einem eingebauten Modell. Gruppen gleichen Namens zählen weiter wie am Pult (Ui24R: Eingang 1–10 Kombi, 11–20 XLR). USB je Richtung eigene Zeile. Gespeichert an dieser Ausrüstung; Kabel/Matrix-Punkte, die nicht mehr passen, gehen nach Rückfrage. Zuerst feste Pult-Felder gebaut, von Marco am selben Tag verworfen (zu starr) |
| Profile | eine fertig eingerichtete Ausrüstung als **Profil speichern** und später **mit der Community tauschen** – später; die Anschlussliste ist dafür schon in sich geschlossen |
| Mono/Stereo | ein Kabel hat eine **Breite** (Mono, Stereo, Multicore) – **eine Linie** auf der Karte, die Verkabelungsliste zeigt jedes physische Kabel (Stereo zwischen zwei Gruppen = zwei Kabel, Stereo-Klinke auf zwei Kanäle = Y-Kabel). In-Ear-Sender mit zwei Mono-Eingängen (L/R) |
| Prüfungen | Kanal doppelt belegt (rot), Kabel breiter als das Ziel und Stereo-Buchse nur einkanalig (Warnung), Adapter nötig (Liste zum Einpacken), belegte Kanäle je Gerät |
| Verkabelungsplan | zuerst als **Liste in der App** je Aufbau („Verkabelung“); PDF/Druck später |
| Fehlende Ausrüstung | neu: In-Ear-**Empfänger** (die Funkstrecke vom Sender ist eine eigene Linie), Funkmikro Sender/Empfänger, DI-Box, Stagebox/Splitter, Kopfhörerverstärker, Instrumenten-Amp, Mikrofon, Instrument |
| Geräte, die noch nicht registriert sind | als **Platzhalter** auf die Karte stellen („nicht registriert“); der **Admin verbindet** ihn später von Hand mit dem echten Gerät – was die Karte für dieses Gerät schon selbst angelegt hatte, geht in den Platzhalter über |
| Alte Geräte (Linux-PC) | neue Geräte kommen weiter von selbst auf die Karte; vom Admin **von der Bühne genommen** bleibt ein Gerät dort weg, bis es wieder platziert wird (so gebaut) |
| Wer spielt (Schritt 2, Teil 1) | im Gig spielt ein Tablet Klick, Track und Ansagen genau dann, wenn seine **Matrix im aktiven Aufbau** sie auf einen Anschluss legt; nicht platziert = spielt nichts; ohne Karte die alten Regeln. Aktiver Aufbau bis zur Wahl im Gig: „Standard“. Die alten Haken je Tablet weichen einem Hinweis |
| Mehrere Apps auf einem Gerät | ein Kasten = **ein physisches Gerät**; Release-App, Dev-App, Chrome und der Stage-Server sind **Apps darauf**, vom Admin zusammengeführt („Dasselbe Gerät wie …“, wieder „Abtrennen“) – keine App erkennt das von selbst. Von mehreren Apps spielt **nur die, die zuletzt nach vorne kam** |
| Vollbild | Dialoge über der Karte (eigene Ebene `z-page`, docs/15); seitliches Verschieben wechselt nicht den Tab; Dialoge mit Textfeld in der App mittig |

## 1. Was der Bühnenplan ist

Ein Bild der Bühne von oben, je Band: **wer steht wo, welches Gerät steht wo, was geht von wo nach wo, und wie gut ist jeder Weg eingemessen.** Er ist der eine Ort, an dem man den Aufbau sieht und ändert – statt verteilt über Bühnentechnik, Tablets & Handys, Latenz-Dialoge und Rig-Check.

```
 ┌──────────────────── Bühne ────────────────────┐
 │      [Drums: Kai]                             │
 │      ◉ Fire (Klick)  🎧 In-Ear                 │
 │                                               │
 │ [Gitarre: Marco]          [Bass: Sven]        │
 │  ◉ Redmi (Master)          ◉ Handy            │
 │  ▣ Kemper ─┐                🎧 In-Ear          │
 │            └──► Pult K7                       │
 │                ▣ CQ-18T ◄── Laptop (Track)    │
 └───────────────────────────────────────────────┘
         (Publikum / Saal)
```

Jeder Weg (Linie) hat einen Zustand: ● eingemessen · ◐ von Hand · ○ fehlt · ✕ instabil.

## 2. Was heute verstreut liegt

| Heute | Was dort steht | Im Bühnenplan |
|---|---|---|
| System → Bühnentechnik | Rollen (Klick, Track, Ansagen …), Logical Devices, Plugins | Rollen hängen an Geräten auf dem Plan |
| System → Tablets & Handys | Geräte, Online-Status, Latenzwerte, Ton-Gesundheit (#703) | Gerätesymbole mit Status; Liste bleibt als Diagnose |
| Latenz… → Nach Gehör abgleichen | Abgleich je Gerät und Weg | am Weg im Plan |
| Rig-Check | Prüflauf mit Test-Song | später „Prüfen“-Ansicht der Karte |
| (#488, #62, nicht gebaut) | Stage Plot/PDF, Rollen-Matrix per Ziehen | bleiben eigene Themen (§0) |

## 3. Was im Plan steht (Daten)

- **Bühne:** schematischer Umriss, keine Maße (§0); Vorlagen (Proberaum, kleine Bühne, große Bühne).
- **Personen:** Bandmitglieder (Profile) mit Position, Instrument und wie sie hören (In-Ear, Wedge, Kopfhörer) – damit ein Weg zeigen kann, wer ihn nutzt.
- **Geräte:** alles mit Zeitbezug – Tablets/Handys, Laptop, Stage-Server, Pult, Interface, Amp-Modeller (Kemper, MG-30), Licht (DMX), Video. Position auf dem Plan; Verknüpfung mit dem echten Gerät (Geräte-Registry, Logical Device).
- **Wege:** physische Wege von einem Ausgang eines Geräts zu einem Ziel: Lautsprecher des Tablets, Kopfhörer, Pult-Kanal, In-Ear-Sender, DMX-Universum. **Je physischem Weg genau eine Latenz-Korrektur** (heute: Latenzprofil je Gerät/Ausgang/Route) und ihr Zustand; Wege ohne Zeitbezug (`soft`/`none`, docs/21) brauchen keine.
- **Rollen:** wer spielt Klick, Track, Ansagen, wer schaltet Kemper/Licht – heute Logical Devices; im Plan als Markierung am Gerät.
- **Nutzer eines Wegs:** wer ihn hört (Personen, „Saal“) – nur Anzeige und Hinweis beim Abgleich, keine eigenen Werte (§0).

Gespeichert band-weit (wie die übrigen Band-Daten), mit **Varianten** je Aufbau (Proberaum / Club / Festival). Messwerte gehören zum Weg, nicht zur Variante: ein im Proberaum eingemessener Weg gilt auf der Bühne weiter (docs/21 §4 Regel 4); nur Abstände und Hörwege ändern sich.

## 4. Ansichten

Zuerst nur die **Liste der Wege**, gruppiert **nach Gerät**, das **eigene Gerät hervorgehoben** (wie „Dieses Gerät“ in Band und bei den Bandmitgliedern) – auf jedem Gerät, auch dem Handy:

```
Redmi Dev  ← dieses Gerät
  ● Lautsprecher     0 ms   Klick → Marco
  ○ Kopfhörer        –      [einmessen]
Fire Dev
  ● Lautsprecher    15 ms   Klick → Kai
Laptop
  ○ Pult K7          –      Track → Saal   [einmessen]
```
Bearbeiten (Wege anlegen, Hörweg wählen) hinter dem Vorhängeschloss: jeder an seinem eigenen Platz, der Admin überall (§0). Später auf denselben Daten die **Karte** (schematisch) mit „Aufbau“ und „Prüfen“ (Ampel je Weg und Gerät – online, Ton sauber (#703), eingemessen); die räumliche Rollen-Matrix (#62) und der Plot (#488) bleiben eigene Themen.

## 5. Einmessen im Plan (verändert den Ablauf)

Heute: ein Gerät wählen → Wert. Im Plan: **ein Weg** (Gerät-Ausgang → Ziel), dessen Nutzer bekannt sind.

- **Startwert:** bekannte Gerätewerte (Plugin-Standard bei Kemper/MIDI); keine Abstände, der Plan ist schematisch (§0).
- **Einmess-Runde:** „Alle fehlenden Wege einmessen“ – das Handy in der Hand, die Wege nacheinander (Referenz gegen Ziel, eigene Tonhöhen, Mikrofon wie PR #700), Wert übernehmen, nachprüfen. Der Plan weiß, welche Wege es gibt und welche fehlen – keine Geräteauswahl von Hand.
- **Wo man steht:** die App sagt es je Weg aus seinen Nutzern („bei Kais In-Ear“, „im Saal“). Ein Weg hat eine Korrektur (§0) – hören ihn mehrere, misst man dort, wo es am meisten zählt (Klick: beim Drummer).
- **Ohne Mikrofon:** von Hand nach Gehör (PR #700) – derselbe Weg, dieselben Werte.
- **Später automatisch:** Pult als Sensor (alle Wege am Pult auf einmal), Kamera für Licht (docs/21 §4).
- **Zustände** je Weg nach den Regeln aus docs/21 §4: zweimal gemessen und gleich → ● eingemessen; weichen ab → ✕ instabil (kein Wert); von Hand → ◐.

## 6. Reihenfolge

Neu seit der Karte (Marco, 2026-11-06); die Wege-Liste aus PR #705 bleibt bis dahin als Übergang.

1. **Datenmodell** (`shared-types/src/stageMap.ts`): Ausrüstung, Anschlüsse, Verbindungen, Patch, Aufbauten, eingebaute generische Modelle, Standard-Karte, Wege je Signalart. Nur Daten, noch von nichts gelesen.
2. **Umschalten, wer spielt:** Klick, Track, Ansagen und Plugins spielen dort, wo der Patch sagt, statt nach `executionTarget` bzw. „der Master spielt“. Ändert, was im Gig zu hören ist – erst nach Marcos Hörtest von #700–#705, gemeinsam auf den Geräten prüfen.
3. **Karte und Liste in der App:** ansehen, bearbeiten, Vollbild, „Prüfen“.
4. **Anschlüsse in den Plugin-Manifesten** (Kemper, CQ-18T).
5. **Aufbau im Gig wählen.**
6. **Einmess-Runde** über die fehlenden Wege (wartet, bis der Rest trägt).
7. Pult als Sensor, Licht per Kamera.

## 7. Ausrüstung und Anschlüsse (§0a)

**Anschluss** = Stecker (DIN-5, USB-B/C, XLR, 6,3/3,5 mm, Ethernet, DMX, eingebaut, Funk) + Signale (Audio, USB-Audio, MIDI, DMX, Netzwerk, Licht) + Richtung (ein/aus/beides) + optional Kanäle (eine Gruppe „Eingänge 1–16“ statt 16 Punkte; beim Verbinden wählt man den Kanal). USB trägt mehrere Signale – eine Verbindung trägt die gemeinsamen Signale beider Enden (Redmi USB-C → UMC USB: USB-Audio und MIDI).

**Woher die Ausrüstung kommt** (drei Schichten):
1. **Generisch, eingebaut:** Mischpult (Zahl der Eingänge einstellbar), Audio-Interface, MIDI-Gerät, Amp-Modeller, In-Ear-Sender, Monitor/Wedge, PA, Licht, Person, Saal. Damit geht jede Band, auch ohne Plugin.
2. **Aus Plugins:** ein Geräte-Plugin bringt sein Modell mit echten Anschlüssen mit (Kemper Player, CQ-18T) – im Manifest wie heute `timing`.
3. **Band-Modelle (Admin):** generisches oder Plugin-Modell kopieren, Anschlüsse anpassen, speichern („unser UMC204HD“).

**StageBoard-Geräte** bekommen ihre Anschlüsse aus dem, was die App erkennt (Lautsprecher, Kopfhörer, USB-C, Bluetooth). **Modell wechseln** (generisches Pult → CQ-18T nach Plugin-Installation) behält Verbindungen, wo das neue Modell einen Anschluss derselben Art hat.

**Wege:** ein Weg beginnt an einem Anschluss eines StageBoard-Geräts und läuft je Signalart (Ton, MIDI, Licht) über passive Ausrüstung bis zu dem, der ihn hört/sieht; ein Gerät, das klingt (Kemper), führt einen MIDI-Weg als Ton weiter. **Je Weg genau eine Korrektur** (§0); der Wert gehört zum physischen Weg (Anschluss → Anschluss) und gilt in jedem Aufbau, in dem dieselbe Verbindung vorkommt. Ändert sich eine Verbindung im Weg: Wert bleibt, Zustand „Weg geändert – neu einmessen“.

**Karte als Master:** eine Verbindung stellt ein, was sie bedeutet – „Redmi USB → Kemper USB“ heißt: das Kemper-Plugin sendet vom Redmi an den MIDI-Anschluss, den das Redmi unter dem Namen „Kemper Player“ sieht (Auflösung **nach Name**, wie heute bei MIDI); Rollen (Klick, Track, Ansagen) hängen an der Verbindung. Findet das Gerät den Anschluss nicht (nicht angesteckt), zeigt „Prüfen“ die Verbindung rot, die betroffenen Widgets gehen in den Disabled State. Wechsel des Aufbaus im Gig wechselt damit auch die Konfiguration; „Prüfen“ zeigt, was in einem Aufbau fehlt. Einstellungen, die keine Verbindung sind (Kemper-Presets), bleiben im Plugin; die alten Stellen für Verbindungen entfallen oder zeigen nur noch „eingestellt in Bühne“.

**Bedienen:** Normalansicht nur Geräte und Linien; Anschluss-Namen an den Linien für den gewählten Weg/das gewählte Gerät oder per Schalter „Anschlüsse“. Verbinden: Gerät antippen → am Anschluss „Verbinden“ → passende Ziele leuchten → Ziel antippen → Anschluss (und Kanal) wählen. Jeder verbindet die Anschlüsse seines eigenen Geräts; Ausrüstung, Anschlüsse und Modelle ändert der Admin.

**Routing-Matrix je Gerät** (Marco, 2026-11-06, ersetzt die Haken am Kabel): jedes Gerät, das routet oder mischt, hat eine Matrix – **Spalten = Eingänge, Zeilen = Ausgänge**, die Ausgangsnamen **rechts** fest („Ausgang ist rechts“). Ein gesetzter Punkt heißt: dieser Eingang geht auf diesen Ausgang; gezeichnet als Linie vom Eingang herunter bis zum Punkt und von dort nach rechts zum Ausgang (wie ein Steckfeld), statt nur eines Hakens. Am Handy scrollt das Raster seitlich, die Ausgänge bleiben stehen.
- **Je Gerät festgelegt**, ob sein Routing änderbar ist: fest (In-Ear-Sender, Wedge, PA, Licht, Amp-Modeller) wird **grau angezeigt**, damit sichtbar bleibt, was wohin geht; frei mit Startwert (Pult **leer** – nie „alles überall“, damit der Klick nicht aus Annahme im Saal landet, docs/28; Interface USB → Out 1/2). Plugin-Modelle bringen ihr Routing mit.
- Die Matrix beschreibt nur, wie das Gerät eingestellt ist; sie stellt am Pult nichts ein. „Prüfen“ soll warnen, wenn Klick oder Ansagen auf Main gehen.
- Welche Signale auf einem Kabel laufen, folgt aus den Matrizen entlang des Wegs – jedes Kabel trägt sie auf der Karte.

**Was ein Antippen zeigt** (Marco, 2026-11-06):
- **Gerät:** nur seine Anschlüsse (rein und raus) und seine Matrix.
- **Kabel, erstes Antippen:** seine beiden Enden (Quelle → Ziel, bei Zwei-Wege-Kabeln beide Endpunkte) und welche Signale darauf laufen.
- **Kabel nochmal antippen oder ein Signal darauf antippen („Klick“):** der ganze Weg des Signals, von wo es kommt bis wo es ankommt.

## 7a. Virtuelle Anschlüsse und Soft-Patching (§0a)

Zwei Ebenen:
1. **Virtuelle Anschlüsse** (heute Logical Devices), band-weit und stabil: Ausgänge („Klick“, „Track“, „Ansagen“, „Kemper“, „Licht“, eigene wie „Klick Drums“) und Eingänge („Pedal“, docs/23). Songs, Cues, Widgets und Auslöser kennen nur diese Namen, nie ein Gerät oder Kabel.
2. **Patch** (die Karte), je Aufbau: in der **Matrix des StageBoard-Geräts** – virtuelle Quellen (Klick, Kemper …) sind Spalten, physische Ausgänge Zeilen; physische Eingänge (USB-, Bluetooth-, WLAN-MIDI eines Pedals oder Keyboards) sind Spalten, virtuelle Eingänge („Pedal“) Zeilen. „Kemper“ im Proberaum: Redmi USB-C → Kemper USB; im Club: Redmi USB-C → UMC → MIDI Out → Kemper MIDI In. Die Songs bleiben gleich, nur der Patch wechselt.

- Ein virtueller Ausgang darf auf **mehrere** Anschlüsse zugleich gepatcht sein (Klick auf Kais In-Ear und Svens Kopfhörer); jeder Patch-Punkt ist ein eigener physischer Weg mit eigener Korrektur.
- Eingänge umgekehrt: ein physischer Anschluss (USB-MIDI des Pedals am Fire) → virtueller Eingang „Pedal“.
- Auf der Karte trägt jedes Kabel, welche Signale darüber laufen („Kemper“ an der MIDI-Linie, „Klick“ an Kopfhörer-, Pult- und In-Ear-Linie).
- Die Standard-Karte (§0a) ist damit: Klick, Track, Ansagen auf den Lautsprecher jedes Geräts gepatcht.
- Virtuelle Anschlüsse legt der Admin an (wie Band-Modelle).

## 8. Offen

- Reihenfolge (§6) an die Karte anpassen: Datenmodell (Ausrüstung, Anschlüsse, Verbindungen, Patch, Aufbauten) und Karte vor der Einmess-Runde.
- Dialog für generische Ausrüstung/Band-Modelle im Detail; welche Anschlüsse die App auf Tablets selbst erkennt.
