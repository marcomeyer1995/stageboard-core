# 31 Bühnenplan – die Bühne als ein Bild (Konzept)

Stand 2026-11-10, Konzept mit Marcos Entscheidungen (§0, §0a: Karte, Anschlüsse, Karte als Master; §0c: Ausbau nach dem Konzept vom 2026-11-09, Issues #737–#753). Anlass: beim Abgleich nach Gehör (PR #700) war der Weg Geräte → ⋯ → Latenz… → Abgleich zu verschachtelt; Marco: Abgleich gehört in einen späteren Bühnenplan mit sichtbarer Aufstellung, und der kann den Ablauf des Einmessens ändern – darum erst dieses Konzept, dann die automatische Einmess-Runde.

Berührt drei Ideen, die dieselben Daten zeigen: **#62** (räumliche Bühnenmatrix), **#488** (Stage Plot und Input-Liste als PDF) und **docs/21 §4 / docs/30** (Ausgabewege mit Latenz, Abgleich, Einmessen). Anfangs nahm der Bühnenplan nur die dritte auf (§0); seit dem Ausbau (§0c) gehören alle drei hierher: #62 und #545 sind mit Karte und Matrix erfüllt und geschlossen, #488 ist der Export (§11, #750).

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
| Plugins (Schritt 2, Teil 2) | ein Logical Device (Kemper, MG-30, RC-500, CQ-18T, MIDI-Clock, Pedal) läuft auf dem Gerät, dessen Matrix es auf einen Anschluss legt (Eingänge: von einem Anschluss hereinnimmt); bei mehreren Apps die vordere, sonst der Stage-Server; nicht geroutet = niemand. Der **MIDI-Port kommt vom Kabel**: sein Name, wie das sendende Gerät ihn sieht, gewählt vom Besitzer beim Verbinden; ohne Namen bleibt der früher eingestellte Port. Der MIDI-Kanal bleibt Geräte-Einstellung |
| Mehrere Apps auf einem Gerät | ein Kasten = **ein physisches Gerät**; Release-App, Dev-App, Chrome und der Stage-Server sind **Apps darauf**, vom Admin zusammengeführt („Dasselbe Gerät wie …“, wieder „Abtrennen“) – keine App erkennt das von selbst. Von mehreren Apps spielt **nur die, die zuletzt nach vorne kam** |
| Vollbild | Dialoge über der Karte (eigene Ebene `z-page`, docs/15); seitliches Verschieben wechselt nicht den Tab; Dialoge mit Textfeld in der App mittig |

## 0c. Entscheidungen (Marco, 2026-11-10) – Ausbau nach dem Konzept vom 2026-11-09

Anlass: Marcos Konzept „StageMap“ vom 2026-11-09 denkt die Karte weiter – Container-Ports und Pins, Signal-Bibliothek, Smart Matrix, Kabel-Prüfer, Live-Ebene, Strom, Auto-Layout, Export, Havarie. Es ist in diese Datei eingearbeitet (§7b–§7e, §9–§12), nicht an ihre Stelle gesetzt: die Entscheidungen aus §0–§0b (Platzhalter, mehrere Apps je Gerät, Pult startet leer, wer bearbeitet) gelten weiter. Sammel-Issue **#737**, Einzel-Issues #738–#753 (§6).

| Frage | Entscheidung |
|---|---|
| Matrix | **die Ausgänge bleiben rechts** („Ausgang ist rechts“, §7) – das Konzept hatte sie links |
| Strom | **Erdung je Gerät** (geerdet / nicht geerdet / Akku) und **Art der Verbindung** (symmetrisch / unsymmetrisch / getrennt) statt Phasen; Steckdosenkreise nur optional (§7e). Es brummt, wenn zwei geerdete Geräte zusätzlich über die Abschirmung eines Kabels verbunden sind – nicht wegen der Phase; der häufigste Fall bei uns ist der Laptop am Netzteil, per USB oder Klinke am Pult |
| Havarie | **zwei Stufen** (Ersatzweg auf demselben Gerät, dann ein anderes Gerät übernimmt); umgeschaltet wird **nur auf einen ausdrücklich festgelegten Ersatzweg, sonst Stille** (docs/28: nie ein falsches Signal ans Publikum); eine **kurze hörbare Lücke ist in Ordnung** – „innerhalb von Millisekunden“ aus dem Konzept ist nicht zu erwarten, Schätzung unter einer Sekunde, zu messen (§12) |
| Kabellängen | **entfallen** – die Packliste zählt Kabel nach Art und Anzahl, der Plan ist schematisch (§0) |
| Reihenfolge | frei; Vorschlag in §6: zuerst das Anschluss-Modell und „der Ton folgt der Matrix“, weil das im Gig fehlt (Klick nur aufs In-Ear, Track ans Pult) |
| Alte Issues | **#62** und **#545** geschlossen (Karte, Matrix und Verkabelungsliste erfüllen sie; der Live-Status aus #545 ist §9, #747); **#488** bleibt und wird mit dem Export (§11, #750) erledigt |

## 0d. Decisions (Marco, 2026-11-11) – the sound follows the map (#742)

Written in English (#785); the rest of this file is translated when touched.

| Question | Decision |
|---|---|
| Gig | the playing device takes its outputs from **its matrix in the active band setup** (§7c) |
| Practice (practice, Timeline, song editor) | per device one choice: **"Everything on both ears"** (default, needs no map) or **a setup** - one of the band's ("Rehearsal room") or one of the person's own. No preset "click left, track right" - that is done in an own setup. Device cues (MIDI to the Kemper) follow the chosen setup as in the gig |
| Own setups ("My setup", #799) | a **full stage map owned by one person**: same model and editor as a band setup (equipment, cables, matrix), so an effects unit, an interface or a pedal at home can be connected. **Per person, not per device** (syncs across the person's devices); several possible ("Home", "Teaching room"); not offered in the gig's setup choice and not listed for other members; **the admin may see and edit them**. Band equipment can be used, own equipment belongs to the person. Measured values belong to the path as always |
| Output missing while practising | also when the device is not placed in the chosen setup: **fall back to "Everything on both ears"** with a hint (no audience at home) |
| Output missing in the gig | **only the affected sources go silent**; sources whose output is still there keep playing (the click on the in-ear survives a pulled USB cable), with a red message. Never played somewhere else (docs/28); the later failover (#752) switches exactly the lost signal |
| Old setting "click left / right" | **removed** (`OutputRouting` store and its settings) |

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
| (#488, #62) | Stage Plot/PDF, Rollen-Matrix per Ziehen | Matrix gebaut (§7), Plot als Export (§11, #750) |

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
Bearbeiten (Wege anlegen, Hörweg wählen) hinter dem Vorhängeschloss: jeder an seinem eigenen Platz, der Admin überall (§0). Die **Karte** (schematisch, seit #706 gebaut) auf denselben Daten; „Prüfen“ (Ampel je Weg und Gerät – online, Ton sauber (#703), eingemessen) ist die Live-Ebene (§9, #747); der Plot (#488) ist der Export (§11).

## 5. Einmessen im Plan (verändert den Ablauf)

Heute: ein Gerät wählen → Wert. Im Plan: **ein Weg** (Gerät-Ausgang → Ziel), dessen Nutzer bekannt sind.

- **Startwert:** bekannte Gerätewerte (Plugin-Standard bei Kemper/MIDI); keine Abstände, der Plan ist schematisch (§0).
- **Einmess-Runde** (#751, braucht die Live-Ebene §9): „Alle fehlenden Wege einmessen“ – das Handy in der Hand, die Runde führt nacheinander über die **Linien der Karte ohne Wert** (Referenz gegen Ziel, eigene Tonhöhen, Mikrofon wie PR #700), Wert übernehmen, nachprüfen. Der Plan weiß, welche Wege es gibt und welche fehlen – keine Geräteauswahl von Hand.
- **Wo man steht:** die App sagt es je Weg aus seinen Nutzern („bei Kais In-Ear“, „im Saal“). Ein Weg hat eine Korrektur (§0) – hören ihn mehrere, misst man dort, wo es am meisten zählt (Klick: beim Drummer).
- **Ohne Mikrofon:** von Hand nach Gehör (PR #700) – derselbe Weg, dieselben Werte.
- **Später automatisch:** Pult als Sensor (alle Wege am Pult auf einmal), Kamera für Licht (docs/21 §4).
- **Zustände** je Weg nach den Regeln aus docs/21 §4: zweimal gemessen und gleich → ● eingemessen; weichen ab → ✕ instabil (kein Wert); von Hand → ◐.

## 6. Reihenfolge

**Gebaut** (PRs #704–#707, 2026-11-06/07): Datenmodell (`shared-types/src/stageMap.ts`: Ausrüstung, Anschlüsse, Verbindungen mit Breite, Patch/Matrix, Aufbauten, generische Modelle, Standard-Karte, Platzhalter, mehrere Apps je Gerät), „wer spielt“ (Klick/Track/Ansagen und Plugins dort, wo der Patch sagt – `mapPlays`, `mapRoute`), Karte und Liste in der App mit Vollbild, freie Anschlussliste, Prüfungen (§0b), Verkabelungsliste. Die Wege-Liste aus PR #705 bleibt daneben.

**Ausbau** (Marco, 2026-11-10; Sammel-Issue #737):

| | Issue | Was | Braucht |
|---|---|---|---|
| A1 | #738 | diese Datei, #62/#545 schließen | – |
| A2 | #739 | Anschluss-Modell 2: Container-Ports, Pins, OSC (§7b) | – |
| A3 | #740 | Signal-Bibliothek: Breite, eigene Signale, Löschen mit Umschreiben (§7a) | – |
| A4 | #741 | Geräte-Modelle aus Add-ons (Manifest, docs/32) | A2, A3 |
| B1 | #742 | der Ton folgt der Matrix, Stufe 1: Ausgang und Pin, Klick links / Track rechts, Mischen (§7c) | A2 |
| B2 | #743 | Stufe 2: mehrere Kanäle über ein USB-Interface (#481, #25) | B1, native Engine #726–#729 |
| B3 | #744 | Smart Matrix: klappbare Gruppen, freie Pins automatisch, Pin-Ebene (§7c) | A2 |
| B4 | #745 | Aufbau im Gig wählen | – |
| C1 | #746 | Kabel-Prüfer: ganze Kette (§7d) | A2 |
| C2 | #747 | Live-Ebene: Status je Gerät und Linie (§9) | – |
| C3 | #748 | Strom und Brummschleifen (§7e) | A2 |
| D1 | #749 | Icons, Zonen, Auto-Layout mit Anpinnen (§10) | – |
| D2 | #750 | Export: Stage Plot, Input-/Output-Liste, Packliste (§11, #488) | D1 |
| E1 | #751 | Einmess-Runde über die Linien (§5, #491) | C2 |
| E2 | #752 | Havarie 1: Ersatzweg auf demselben Gerät (§12) | B2 |
| E3 | #753 | Havarie 2: ein anderes Gerät übernimmt (§12) | B4, E2 |

Vorgeschlagene Reihenfolge: A1 → A2 → B1 → B3 → C1 → B4 → C2, danach A3/A4, dann D und E. Danach wie bisher: Pult als Sensor, Licht per Kamera (docs/21 §4).

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

**Signal-Bibliothek** (Konzept 2026-11-09, #740): die virtuellen Anschlüsse sind die Signal-Bibliothek der Band, nur der Admin pflegt sie.
- Jedes Signal hat eine **Breite** (Mono: Klick; Stereo: Track) – daraus folgt, wie viele Pins es in der Matrix belegt.
- **Standards** (Klick, Track, Ansagen, Fußschalter) lassen sich umbenennen und verdoppeln, nicht löschen. **Aus Add-ons** kommt das Signal mit dem Geräte-Modell (§7, #741): stellt man den Kemper auf die Karte, legt die App „Kemper“ an, falls es fehlt – geroutet wird nichts von selbst. **Eigene Signale** legt der Admin an („Stem: Drums“, Stereo; welche Spur es speist, klärt docs/22).
- **Löschen mit Umschreiben:** wird ein Signal noch benutzt (Cues, Widgets, Auslöser, Matrix-Punkte), zeigt die App wie oft und wo und fragt nach dem Signal, auf das umgeschrieben wird – oder bricht ab. Kein stilles Löschen.

## 7b. Anschluss-Modell 2: Container-Ports und Pins (#739)

**Gebaut 2026-11-11** (Datenmodell, Prüfungen, Signalwege, Anschlussliste, Matrix-Zeilen; der Ton selbst folgt der Matrix erst mit #742): `PortPart`, `Port.pins`/`Port.parts`, `MatrixPoint.pin`/`PortRef.pin`, Signal `osc`, `lookupPort`/`cablePortId`, `normalizeEquipment` (alte Karten beim Lesen: `stereo` → `pins: 2`, USB/Netz ohne Teile bekommt Standard-Teile), `partChannels` (Kanalzahl vom anderen Ende des Kabels), `portSlots`. Ein Matrix-Punkt auf dem Container (vor #739) gilt weiter als „alles davon“.

Vorher hatte ein Anschluss Stecker, Signale, Richtung und optional eine Kanalzahl für die ganze Gruppe; USB steht je Richtung in einer eigenen Zeile. Ein Interface mit 4 Audio-Ausgängen, 2 Eingängen und MIDI über **ein** USB-Kabel lässt sich so nicht beschreiben. Darum:

- **Container-Ports:** USB, Netzwerk (RJ45, Dante) und Bluetooth fassen Teile zusammen – **Protokoll** (Audio, MIDI, OSC, Netz) → **Richtung** → **Kanäle**. Auf der Karte bleibt es **ein** Kabel mit Signal-Marken; in Matrix und Anschlussliste klappt der Port auf.
- **Pins:** jede Buchse hat Pins (Klinke mono = 1, Klinke stereo / Kopfhörer = 2) – ersetzt den Haken „Stereo“. Matrix-Punkte und Kabelenden können einen Pin nennen.
- Signal **OSC** (für #484).
- Bestehende Karten werden beim Lesen umgerechnet, kein Neuanfang.

## 7c. Der Ton folgt der Matrix; Smart Matrix (#742, #743, #744)

Heute entscheidet die Karte nur, **ob** ein Gerät Klick, Track oder Ansagen spielt (`mapPlays`); alles läuft gemischt auf dem Ausgang, den Android gerade nutzt. Speist das Gerät die PA, hört das Publikum den Klick. Darum in zwei Stufen:

1. **Ausgang und Pin** (#742): die Matrix des Tablets legt jedes Signal auf einen Ausgang und Pin – Klick auf Kopfhörer links, Track rechts. **Mischen ohne Bus-Einstellung:** mehrere Signale auf demselben Pin mischt die Engine; ein Stereo-Signal auf einem einzelnen Pin wird zu Mono summiert (Hinweis in der Matrix). Ein Signal klingt **nur** auf dem Ausgang, den die Matrix nennt – nutzt Android gerade einen anderen (Kopfhörer abgezogen → Lautsprecher), bleibt es still und die Verbindung wird rot (docs/28). Die Standard-Karte bleibt: alles auf beiden Kanälen des Lautsprechers.
2. **Mehrere Kanäle über ein USB-Interface** (#743): Klick auf 1/2, Track auf 3/4, Ansagen wahlweise eigen – braucht die native Engine (docs/28, docs/30); Interface abgezogen = sicherer Stopp, Ersatzweg erst mit §12.

**Smart Matrix** (#744, gebaut 2026-11-11: Gruppen zu bis zum Öffnen, geschlossene Gruppe zeigt „belegt/gesamt“, Tippen auf eine geschlossene Gruppe belegt die nächsten freien Zeilen in der Breite des Signals (Track = 2 nebeneinander) oder räumt sie, Pins-Gruppe geschlossen = ganze Buchse, zwei geschlossene Gruppen öffnen sich; Rückfrage „Pin ist belegt“ wartet auf das Mischen-Merkmal aus #746), damit 32 × 32 am Handy bedienbar bleibt:
- **Klappbare Gruppen:** Kanalgruppen („Eingang 1–16“) und Container-Ports sind zu, bis man sie öffnet; eine geschlossene Gruppe zeigt, was in ihr geroutet ist. Nur offene Gruppen werden gezeichnet.
- **Freie Pins automatisch:** ein Signal auf eine geschlossene Gruppe gelegt nimmt die nächsten freien Pins passend zur Breite (Stereo = zwei nebeneinander); sofort sichtbar und änderbar.
- **Pin-Ebene:** aufklappen bis zum einzelnen Pin.
- Mehrere Punkte je Ausgang, wo das Gerät mischt; wo nicht: Rückfrage „Pin ist belegt: ersetzen oder anderen wählen“ (Dialog der App, docs/15).
- Antippen zuerst, Ziehen nur zusätzlich; Trefferflächen ≥ 48 px; **Ausgänge rechts** (§0c).

## 7d. Kabel-Prüfer (#746)

Die Prüfungen aus §0b (doppelt belegt, Kabel breiter als das Ziel, Stereo-Buchse einkanalig, Adapter) werden zur **ganzen Kette**: Breite der Quelle → des Kabels → des Ziels, auch durch die Matrizen hindurch.
- Stereo-Signal auf Mono-Kabel: „ein Kanal geht verloren – in der Matrix zusammenmischen“.
- **Mono-Stecker in einem Stereo-Ausgang** (Klinke mono in der Kopfhörerbuchse): **rot** – der rechte Kanal wird kurzgeschlossen. An einem Eingang bleibt es eine Warnung.
- Zwei Signale auf einen Pin eines Geräts, das **nicht mischt**: rot. Dafür sagt jedes Modell, ob es mischt.
- Adapter bleiben stille Einträge für die Packliste (§11).

## 7e. Strom und Brummschleifen (#748)

Nach §0c: keine Phasen. Je Modell ein Startwert für die **Erdung** (Pult geerdet, Tablet auf Akku, Laptop: Rückfrage „am Netzteil?“); je Stecker ein Startwert für die **Verbindung** (XLR symmetrisch, Klinke mono unsymmetrisch, USB führt Masse, MIDI DIN und Funk getrennt; DI-Box und Trenner trennen). **Prüfung:** zwei geerdete Geräte, die über eine Kette von Kabeln mit Masse verbunden sind – liegt ein unsymmetrisches Kabel darin: rot, „Brummschleife wahrscheinlich – DI-Box oder Trenner“; nur symmetrische Kabel: höchstens ein leiser Hinweis. Optional Steckdosen auf der Karte mit Geräten daran.

## 8. Offen

- Dialog für generische Ausrüstung/Band-Modelle im Detail; welche Anschlüsse die App auf Tablets selbst erkennt.
- Havarie (§12): wie lang die Lücke beim Umschalten wirklich ist (messen); nach wie vielen Sekunden ohne Lebenszeichen ein Gerät als ausgefallen gilt (zu kurz = doppelte Wiedergabe bei einem WLAN-Aussetzer); wer entscheidet, wenn das ausgefallene Gerät der Host selbst ist (docs/25 §8, #782).
- Welche Spur ein eigenes Signal wie „Stem: Drums“ speist (§7a, docs/22).

## 9. Live-Ebene (#747)

Schalter **„Aufbau | Prüfen“** auf der Karte. Prüfen zeigt je **Gerät**: online / App offen, Akku (neu zu erfassen), Ton sauber (#703), Uhr-Abweichung; Stage-Server online; Ausrüstung: Treiber meldet sich oder MIDI-Anschluss fehlt. Je **Linie**: Anschluss gefunden (MIDI-Name löst auf), Zustand des Wegs ● eingemessen · ◐ von Hand · ○ fehlt · ✕ instabil. Rot nur für Fehler (wie die Statusleiste). Aktualisierung über den Posteingang, Klasse Hintergrund (docs/26) – die Karte darf im Song nichts stören. Widgets, deren Verbindung fehlt, gehen wie bisher in den Disabled State. „Tablets & Handys“ bleibt die Diagnose-Liste.

## 10. Icons, Zonen und Auto-Layout (#749)

- **Icons** je Art von Ausrüstung (Tablet, Pult, Amp, In-Ear, Wedge, Mikrofon, DI …) als Vektorgrafik im UI-System (docs/15), in beiden Themes lesbar.
- **Zonen:** Drums hinten, Backline, Front, FOH/Saal außerhalb – schematisch, keine Maße (§0).
- **Auto-Layout:** neue Ausrüstung landet in ihrer Zone bei ihrer Person; „Aufräumen“ ordnet alle nicht angepinnten Kästen so, dass sich möglichst wenige Kabel kreuzen. **Anpinnen:** was von Hand verschoben wurde, bleibt; ohne „Aufräumen“ bewegt die App nichts von selbst.

## 11. Export für die Crew (#750, erledigt #488)

Je Aufbau ein PDF, erzeugt in der App (auf jedem Host, auch Solo; kein Druckdialog des Browsers), geteilt über Android:
- **Stage Plot:** die Karte ohne Tablets, MIDI und Strom – Musiker, Wedges, Mikrofone, DI, Sub-Mixer.
- **Input-Liste** (was ans FOH-Pult geht: Kanal, Quelle, Mikrofon/DI) und **Output-Liste** (welcher Aux wohin).
- **Packliste:** Kabel nach Art und Anzahl, Adapter – **ohne Längen** (§0c).
- Notizen und Kontakt für den Techniker.

## 12. Havarie (#752, #753)

Digitale Wege (USB, Netz) fallen live am ehesten aus. Die App kann keinen fehlenden Anschluss ersetzen, aber auf einen **vorher festgelegten** Ersatzweg umschalten (§0c: nur auf einen festgelegten, sonst Stille; kurze Lücke in Ordnung).

1. **Ersatzweg auf demselben Gerät** (#752, braucht §7c Stufe 2 – erst mit einem USB-Interface gibt es einen Ausgang, der wegfallen kann, und einen zweiten): in der Matrix legt der Admin neben dem Hauptweg einen Ersatz fest (langes Drücken und über ⋯), z. B. den Kopfhörerausgang, der vorsorglich am Pult steckt. Fällt der Hauptausgang weg (USB abgezogen), schaltet die Engine um und steigt über die gemeinsame Uhr wieder im Takt ein. Zurück auf den Hauptweg nicht von selbst im laufenden Song (noch eine Lücke) – von Hand oder beim nächsten Song.
2. **Ein anderes Gerät übernimmt** (#753, braucht Aufbau im Gig und Stufe 1): für ein Signal (Track) ist ein anderes Gerät als Ersatz festgelegt; fällt das spielende Gerät ganz aus, übernimmt der Ersatz an derselben Stelle (gemeinsame Uhr). Voraussetzung: der Track liegt auf dem Ersatzgerät – die Live-Ebene zeigt, wenn nicht. Kommt das ausgefallene Gerät zurück, bleibt es still, bis der Admin zurückschaltet – nie doppelt.

Karte: Hauptlinie rot, Ersatzlinie orange, Meldung an den Admin. Offen: §8.
