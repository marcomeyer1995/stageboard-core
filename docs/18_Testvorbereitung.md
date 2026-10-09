# Testvorbereitung Synchronität

Stand: 2026-10-09. Schritt-für-Schritt-Anleitung, um den Testplan (docs/17) durchzuführen: was gebraucht wird, was gekauft werden muss, wie aufgebaut wird, welche Aufbauvarianten verglichen werden, wo die Grenzen der Messung liegen, und wie am Ende entschieden wird, welche Aufbauten auf der Bühne taugen und welche Korrekturen nötig sind.

## 1. Ziel in einem Satz

Für jeden Aufbau, den eine Band realistisch nutzen würde, eine **Zahl mit Fehlerbalken**: wie weit liegen Klick, Track, Bild und Cues auseinander - im Gerät, zwischen den Geräten und gegen die Songzeit - und danach ein klares **„geht / geht mit Ausgleich / geht nicht“**.

## 2. Rollen

- **Marco:** Einkauf, Aufbau und Verkabelung, Pegel am Pult, alles was einen echten Finger braucht, Linux auf dem Dell installieren.
- **Claude:** Werkzeuge bauen, Server einrichten (per SSH), Geräte-Rollen setzen, Messläufe steuern, aufnehmen, auswerten, Protokoll und Bericht, danach den Ausgleich umsetzen und nachmessen.

## 3. Hardware: vorhanden, bestellt, zu kaufen

### 3.1 Vorhanden / bestellt

- [ ] Soundcraft **Ui24R** - Mess-Rückgrat: nimmt alle Geräte gleichzeitig mit einer Uhr auf (per USB am Laptop)
- [ ] **Behringer UMC204HD** (bestellt) - zweites Interface: als Ausgabeweg eines Tablets (Aufbau P3), als unabhängige Gegenmessung zum Ui24R (K6) und mit seinen **MIDI-Buchsen (In/Out)** für die MIDI-Messungen (§4.6)
- [ ] Laptop (heutiger Stage-Server)
- [ ] Dell-Mini-PC (künftiger Stage-Server, Aufbau S-B)
- [ ] Xiaomi-Tablet, Xiaomi-Handy, Fire HD 10, Samsung S26 (+ ggf. Windows-Tablet)
- [ ] WLAN-Router, wie er auf der Bühne genutzt wird

### 3.2 Zu kaufen (Pflicht)

| Teil | Anzahl | Wofür | Hinweis |
|---|---|---|---|
| Klinkenkabel 3,5 mm Stereo → 2 × 6,3 mm Mono (Insert-Y) **oder** 3,5 mm → 6,3 mm Stereo, 2–3 m | 6 | Geräte-Kopfhörerausgang → Ui24R-Eingang | Y-Variante: linker und rechter Kanal getrennt aufs Pult - hilfreich, wenn Klick und Track getrennt geroutet werden |
| USB-C-auf-Klinke-Adapter (mit eigenem DAC), **gleiches Modell zweimal** | 2 | S26, Xiaomi-Handy | Modell notieren - der Adapter ist Teil des Messwegs |
| 6,3-mm-Klinkenkabel TRS ↔ TRS, 1–2 m | 4 | UMC204HD-Ausgänge → Ui24R-Eingänge | |
| USB-C-Hub/OTG-Adapter **mit Ladeanschluss (PD-Durchleitung)** und USB-A-Buchse | 2 | UMC204HD an Tablet/Handy anschließen und das Gerät gleichzeitig laden | ohne Laden leert das Interface den Akku; nur Hubs mit „PD pass-through“ |
| Y-Kabel 3,5 mm Stecker → 2 × 6,3 mm | 1 | Kalibrierung K1 (ein Signal auf zwei Kanäle) | |
| Mehrfachsteckdose, Ladekabel für alle Geräte | - | alles am Strom | |
| Kabel-Etiketten | 1 Rolle | Kanalnummer an jedes Kabel | verhindert vertauschte Kanäle |
| Fotodiode **BPW34** (oder SFH 203 P) | 3 (+1 Reserve) | Lichtsensoren: Scheinwerfer, Bildschirm A, Bildschirm B | wenige Cent bis 1 € |
| 6,3-mm-Mono-Klinkenkabel (TS) zum Anlöten, oder Stecker + Kabel | 3 | Sensor → Ui24R | |
| Widerstand 10 kΩ, Schrumpfschlauch, schwarzes Isolierband | je 3 | Sensoren | Lötkolben vorhanden? |
| MIDI-Kabel 5-pol DIN, 1–2 m | 3 | MIDI-Strecken M1–M3 (§4.6) | |
| USB-MIDI-Interface mit In und Out, **Markengerät** (z. B. Roland UM-ONE mk2) | 1 | zweiter MIDI-Anschluss am Laptop: Empfänger für die Cue-Messung bzw. Sender für die Fußschalter-Messung | billige No-Name-Kabel haben oft unsaubere Zeitstempel - die verfälschen genau das, was gemessen wird |

### 3.3 Empfohlen

| Teil | Wofür |
|---|---|
| DMX-Kabel 3-pol XLR (Wandler → Moving-Head), ggf. Abschlusswiderstand 120 Ω | S17 |
| Masseschleifen-Trenner 3,5 mm (2 Stück) | falls es brummt, wenn Laptop, Pult und Tablets gleichzeitig am Netz hängen |
| **Fender Mustang Micro Plus** (vorhanden) + Kabel 3,5 mm Klinke → 6,3 mm Klinke/XLR-DI ins Ui24R | S12 Bluetooth (#468) - Ladestand voll, Gitarreneingang stumm |

### 3.4 Später, nicht für den ersten Test

| Teil | Wofür |
|---|---|
| Raspberry Pi 5 + SSD | Vergleich als günstige „Box“ (Server-Variante S-C) |

## 4. Aufbauvarianten

### 4.1 Mess-Rückgrat (bei jedem Test gleich)

Jeder Ausgang, der gemessen wird, geht auf **einen eigenen Ui24R-Eingang**. Der Ui24R hängt per USB am Laptop; der Laptop nimmt alle Kanäle gleichzeitig auf. Alle Kanäle haben damit **dieselbe Uhr** - Abstände zwischen Kanälen sind exakt messbar. Die Kanalbearbeitung am Ui24R (EQ, Kompressor, Gate, Hochpass, Effekte) ist für die Messkanäle aus.

### 4.2 Ausgabewege (was ein Musiker hört)

| Kürzel | Weg | Bühnenbeispiel |
|---|---|---|
| **P1** | Tablet-Kopfhörerbuchse → Pult | Musiker hängt sein Tablet direkt an den IEM-Sender oder ans Pult |
| **P2** | Handy USB-C → Klinkenadapter → Pult | Handy ohne Kopfhörerbuchse |
| **P3** | Tablet → USB → **UMC204HD** → Pult | Tablet mit eigenem Audio-Interface (sauberer Pegel, symmetrisch) |
| **P4** | Tablet → USB → **Ui24R** (als Soundkarte) | Tablet speist das Pult digital, ohne Kabel-DAC (nur wenn der Ui24R am Tablet funktioniert) |
| **P5** | Gerät → Bluetooth → Fender Mustang Micro Plus → Kopfhörerausgang → Pult | Gitarrist hört Track/Klick über seinen Mustang (#468) |
| **P6** | Stage-Server → UMC204HD/Ui24R → Pult | Klick/Track vom Server statt von einem Tablet - **heute nicht messbar**, der Server-Klick ist noch nicht gebaut (#25); wird nachgeholt |

### 4.3 Server-Varianten

| Kürzel | Server | Wann |
|---|---|---|
| **S-A** | Laptop (heute) | Testtag 1 und 2 |
| **S-B** | Dell-Mini-PC, frisch eingerichtet | eigener Termin |
| **S-C** | Raspberry Pi 5 | nur falls gekauft |

### 4.4 Rollen in der Band (aus Sicht der App)

| Kürzel | Wer spielt was |
|---|---|
| **R1** | ein Gerät spielt Klick **und** Track (z. B. Bühnen-Tablet) |
| **R2** | Gerät A Klick, Gerät B Track (Drummer-Klick gegen Backing-Track) |
| **R3** | alle Geräte Klick, eines zusätzlich Track (jeder Musiker hört seinen eigenen Klick) |

### 4.5 Was mit was kombiniert wird

| Szenario (docs/17) | Ausgabewege | Rollen | Server |
|---|---|---|---|
| S0 Kalibrierung | P1, Laptop | - | S-A |
| S1 Editor | P1, P2 | R1 | S-A |
| S2 Solo | P1, P2, P3 | R1 | S-A |
| S3 Gig ein Gerät | P1, P2, P3 | R1 | S-A, später S-B |
| S4 Gig Paare | P1, P2 | R2 | S-A |
| S5 Gig alle | P1, P2, P3 | R3 | S-A, später S-B |
| S6 Störungen | P1 | R1, R3 | S-A |
| S7 Netzlast | P1 | R3 | S-A |
| S8 Bildschirm aus | P1 | R1 | S-A |
| S9 Cues und MIDI | M1, M2, M3 (M4 wenn Gerät da) | R1 | S-A, später S-B |
| S10 Bild | P1 | R3 | S-A |
| S11 Builds/App | P1, P2 | R1 | S-A |
| S12 Bluetooth | P5 | R1 | S-A |
| S13 echte Musik | P1 | R1 | S-A |
| S14 Langlauf | P1, P2, P3 | R3 | S-B |
| S15 Server-Varianten | P1 | R1, R3 | S-B (S-C) |
| neu: S16 Interface am Tablet | P3, P4 gegen P1 desselben Geräts | R1 | S-A |
| neu: S17 Licht/DMX | L0 (zuerst), L1, L2, später L3 | R1 | S-A |

### 4.6 MIDI-Strecken

Jede MIDI-Nachricht wird in einen **Piep in derselben Aufnahme** verwandelt: ein kleines Programm auf dem Laptop (**Cue-Piepser**) hört auf einen MIDI-Eingang und piept im Moment des Empfangs über einen eigenen Laptop-Ausgang in den Ui24R (Kanal 7). Damit liegen Cue, Klick und Track in einer Aufnahme und sind auf die Millisekunde vergleichbar. Die eigene Verzögerung des Piepsers wird vorher bestimmt (K7).

| Kürzel | Strecke | Was gemessen wird | Bühnenbeispiel |
|---|---|---|---|
| **M1** | Stage-Server → UMC204HD (am Server) MIDI Out → Kabel → UM-ONE In (Laptop) → Piepser | Server-Cue gegen Songzeit und gegen Klick/Track der Geräte | Server schaltet Kemper/Licht |
| **M2** | Tablet → USB-C-Hub → UMC204HD MIDI Out → Kabel → UM-ONE In (Laptop) → Piepser | Cue vom Tablet (WebMIDI) gegen Songzeit; **ob WebMIDI über ein Interface am Tablet überhaupt geht** (Browser und Android-App getrennt prüfen - die App nutzt die Android-WebView, die WebMIDI womöglich nicht kann) | Gitarrist schaltet seinen Amp vom eigenen Tablet |
| **M3** | Laptop sendet zu bekannter Zeit über UM-ONE Out → Kabel → UMC204HD MIDI In (am Tablet) → App reagiert (z. B. „Weiter“, „Play“) | Eingabe-Latenz: Pedal → Aktion (erster Klick/Track nach dem Befehl); der Laptop piept beim Senden gleichzeitig auf Kanal 7 | MIDI-Fußschalter (RC-500, MG-30 als Controller) |
| **M4** | Tablet/Server → echtes Effektgerät (Kemper, MG-30, RC-500) → dessen Audio-Ausgang in den Ui24R | Patch-Wechsel hörbar gegen den Schlag - inklusive der Zeit, die das Gerät intern braucht | echtes Bühnengerät (nur wenn verfügbar) |

Für M1 wird das UMC204HD am Stage-Server (Laptop bzw. Dell) betrieben, für M2/M3 am Tablet - also nacheinander, nicht gleichzeitig.

### 4.7 Licht (DMX)

Heute hat StageBoard für Licht nur ein **Platzhalter-Plugin** (`mock-lighting`, Stellvertreter für eine Brücke zu QLC+/Maestro) - es gibt noch keinen echten DMX-Weg. Gemessen wird deshalb zuerst, was die Hardware kann, und dann, ob sich ein direkter Weg lohnt (interessant für kleine Bands ohne Lichtpult).

**Vorhanden (Marco, 2026-10-09):**
- **USB-DMX-Wandler:** usangreen „USB zu DMX“, FTDI-basiert, XLR 3-pol - Bauart „Open DMX“ **ohne eigenen Mikrocontroller**: der Rechner erzeugt jeden DMX-Rahmen selbst (Break, 512 Kanäle, Wiederholrate). Zeitverhalten hängt damit von Rechner, Treiber und Last ab - genau das wird quantifiziert. QLC+ kann diese Bauart („Enttec Open DMX“).
- **Scheinwerfer:** U'King LED-Moving-Head (klein). Gemessen wird über den **Dimmer-/Shutter-Kanal** (Licht an/aus), nicht über Bewegung. Kanalmodus und DMX-Adresse notieren; interne Glättung des Dimmers ist Teil der Messung.
- **QLC+:** läuft heute eigenständig (nicht ferngesteuert).
- **Maestro DMX** (neueste Software): noch nicht gekoppelt; nimmt **MIDI über einen USB-MIDI-Adapter** und **OSC über Ethernet** an.

| Kürzel | Strecke | Was gemessen wird | Voraussetzung |
|---|---|---|---|
| **L0** | DMX-Testprogramm auf dem Laptop → usangreen-Wandler → Moving-Head | Eigenverzögerung und Jitter von Wandler + Scheinwerfer | nur das Testprogramm (Claude) |
| **L1** | StageBoard-Cue → MIDI → **QLC+** (Laptop) → usangreen-Wandler → Moving-Head | Kette mit QLC+ | in QLC+ ein MIDI-Eingangsprofil: Note/Program Change → Szene |
| **L2a** | StageBoard-Cue → MIDI (5-pol, über UMC204HD/UM-ONE) → **Maestro DMX** → Moving-Head | Kette mit Maestro über MIDI-Kabel | Maestro: MIDI-Zuordnung Note/PC → Szene |
| **L2b** | OSC über Ethernet → **Maestro DMX** → Moving-Head | Kette mit Maestro übers Netz | zuerst mit einem **OSC-Testprogramm** (sendet zu bekannter Zeit und piept dabei); aus StageBoard erst, wenn ein OSC-Sender gebaut ist - heute ist „Netzwerk (OSC)“ nur im Plugin-Katalog beschrieben, es gibt keinen Sender |
| **L3** | StageBoard-Server → usangreen-Wandler **direkt** → Moving-Head | Weg ohne Lichtpult (kleine Bands) | ein kleines DMX-Plugin für den Server - Funktion, nicht nur Test; nur bauen, wenn L0 gut aussieht |

**Licht messen: Lichtsensor in den Ui24R** (Marcos Wahl). Eine Fotodiode an einem Klinkenkabel auf einem Line-/Mic-Eingang des Ui24R - Licht wird zu einem Signal in derselben Aufnahme wie Klick, Track und MIDI, auf ±0,1 ms. Derselbe Sensor auf einen **Tablet-Bildschirm** geklebt misst Blitze, Einzählen und Statusleiste (S10) - deshalb **drei** Sensoren bauen: Scheinwerfer, Bildschirm A, Bildschirm B. Später auch als **Licht-Kalibrierung für Bands** denkbar (wie der Referenz-Song für den Ton).

**Sensor bauen** (je Sensor ca. 10 min, Material §3.2):
1. Fotodiode BPW34 (oder SFH 203 P): Anode an die Spitze (Tip), Kathode an den Schirm (Sleeve) eines 6,3-mm-Mono-Klinkensteckers bzw. eines Kabels mit Stecker. 10-kΩ-Widerstand parallel zur Diode (macht sie schnell und gleichmäßig).
2. Lötstellen mit Schrumpfschlauch isolieren, die Diode in schwarzes Isolierband/eine kleine Kappe, so dass nur die Vorderseite Licht sieht (Raumlicht stört sonst).
3. In einen **Eingang ohne Phantomspeisung** stecken (Phantom aus! sie würde über die Diode liegen), Gain hochdrehen, bis ein Lichtwechsel deutlich ausschlägt.
4. Probe: Taschenlampe an/aus - der Kanal muss klar springen.

**S16 (neu, Marcos Frage):** Kann ein Tablet ein USB-Audio-Interface betreiben, und ist das besser als die Kopfhörerbuchse? Je Gerät: wird das UMC204HD erkannt (Android gibt dann allen Ton dorthin), Versatz und Streuung gegen P1, Akku unter Last, Knackser bei Ein-/Ausstecken. Gleiches mit dem Ui24R als Soundkarte (P4), falls es am Tablet funktioniert.

## 5. Grenzen der Messung (was der Test **nicht** zeigt)

1. **Elektrischer Ausgang, nicht das Ohr:** gemessen wird am Kabel. Funk-In-Ear-Strecken (Sender/Empfänger), Lautsprecher und Raumschall kommen nicht vor. Digitale IEM-Systeme fügen typischerweise wenige ms hinzu - gleich für alle Musiker, verschiebt also nicht den Abstand zwischen ihnen.
2. **Pult-Latenz:** der Ui24R selbst verzögert alle Eingänge gleich (ca. 1–2 ms) - für Abstände zwischen Kanälen ohne Bedeutung, für die absolute Lage gegen die Songzeit Teil des Messwegs.
3. **Absoluter Bezug zur Songzeit:** die Pieps im Track tragen die Songzeit, aber jedes Gerät gibt sie mit seiner eigenen Verzögerung aus. Den absoluten Bezug liefert der Laptop (Server-Uhr, Klinke → Ui24R), dessen eigene Ausgabelatenz einmal per Kalibrierung bestimmt wird. Genauigkeit des absoluten Bezugs: etwa ±5 ms; Abstände zwischen Kanälen: ±1 ms.
4. **Nur unsere Geräte:** Ergebnisse gelten für diese Modelle, Android-Versionen, Browser- und App-Versionen. Andere Geräte einer Band brauchen ihren eigenen Kurztest - genau dafür ist der Referenz-Song in der App gedacht (#464 Schritt 5).
5. **Nur unsere Software-Stände:** main und #460 vom Testtag. Jede spätere Änderung an Uhrabgleich, Klick oder Audio braucht einen Wiederholungslauf (deshalb ist der Test als Werkzeug wiederholbar gebaut).
6. **Stichprobe:** 3 Läufe je Fall zeigen Lage und Wiederholbarkeit; seltene Ereignisse (ein Aussetzer pro Stunde) zeigt nur der Langlauf S14, und auch der nur, wenn sie in der Stunde vorkommen.
7. **WLAN:** die Last am Veranstaltungsort (Publikumshandys, fremde Netze) lässt sich nicht nachbauen; S7 simuliert Last und schwachen Empfang nur.
8. **Bild:** gemessen mit Lichtsensor auf dem Bildschirm. Bildschirme zeigen nur alle ~16,7 ms (60 Hz) ein neues Bild und dimmen oft per Flimmern (PWM) - das ist Teil des Ergebnisses; die Auswertung glättet das Flimmern.
9. **MIDI:** gemessen wird bis zum Empfang im Cue-Piepser (dessen eigene Verzögerung ist kalibriert, K7). Was ein echtes Effektgerät intern braucht, bis der Patch umschaltet, kommt nur in M4 vor, und nur für die Geräte, die da sind. Eine MIDI-Nachricht selbst braucht auf dem Kabel ca. 1 ms (31,25 kBit/s); USB-MIDI-Interfaces fügen typischerweise 1–5 ms hinzu - das ist Teil der Messung, und deshalb ein Markengerät.
10. **MIDI am Tablet:** ob ein Android-Gerät ein USB-Interface mit MIDI über WebMIDI ansprechen kann, hängt von Gerät, Android-Version und Laufzeit ab (Chrome kann WebMIDI, die Android-WebView der App womöglich nicht). Ergebnis ist Teil des Tests, nicht Voraussetzung.
11. **Licht:** DMX sendet den ganzen Datenrahmen nur etwa 25–44-mal pro Sekunde - eine Änderung kommt im Mittel einen halben Rahmen später an (ca. 10–20 ms), außer es werden kürzere Rahmen gesendet. Beim usangreen-Wandler (ohne eigenen Mikrocontroller) erzeugt der Rechner die Rahmen - Last auf dem Rechner kann Rahmen verzögern (Jitter). Der Moving-Head verarbeitet DMX intern und glättet ggf. den Dimmer - diese Zeit gehört zum Scheinwerfer, ist aber in der Messung enthalten. Ergebnisse gelten für **diesen** Wandler und **diesen** Scheinwerfer. L3 ist erst messbar, wenn das DMX-Plugin gebaut ist; L2b aus StageBoard heraus erst mit einem OSC-Sender (bis dahin per Testprogramm).
12. **Server-Klick (P6):** heute nicht messbar (#25 nicht gebaut).
13. **Wahrnehmungsgrenzen:** die Grenzwerte (docs/17 §8) stützen sich auf übliche Erfahrungswerte (Flam ab ~10–20 ms, deutlich doppelt ab ~30 ms); jeder Musiker ist anders empfindlich - deshalb gehört zum Abschluss auch ein Hörtest durch die Band.

## 5a. Zusätzliche Kalibrierungen (ergänzen docs/17 §5, K1–K5)

| Nr. | Prüfung | Vorgehen | Muss ergeben |
|---|---|---|---|
| K6 | Ui24R gegen UMC204HD (zwei unabhängige Messketten) | dasselbe Gerätesignal per Y-Kabel gleichzeitig in den Ui24R und ins UMC204HD (beide am Laptop), denselben Lauf mit beiden auswerten | gleicher Versatz Klick minus Track ± 1 ms - sonst misst eine Kette falsch |
| K7 | Eigenverzögerung des Cue-Piepsers und der MIDI-Strecke | Laptop sendet zu bekannter Zeit MIDI über UMC204HD Out → Kabel → UM-ONE In → Piepser piept auf Kanal 7; gleichzeitig piept der Laptop direkt auf Kanal 5 | Abstand Kanal 7 gegen 5 = Verzögerung von MIDI-Strecke + Piepser; wird von allen MIDI-Messungen abgezogen; Streuung ≤ 2 ms |

## 6. Vorbereitung Schritt für Schritt

### Phase 0 - Entscheidungen und Einkauf (Marco)

- [ ] Fragen aus docs/17 §15 beantworten (Grenzwerte, Geräteliste, Adaptermodelle, Ui24R-Eingänge, MIDI-Gerät, Termine)
- [ ] Einkaufsliste §3.2 bestellen (und §3.3 nach Wunsch)
- [ ] Zwei Termine à 4–5 h festlegen (Testtag 1: Blöcke A–C, Testtag 2: D–F) und einen für den Dell
- [ ] Dell: Modell, CPU, RAM, SSD an Claude

### Phase 1 - Werkzeuge (Claude, vor dem ersten Termin)

- [ ] Auswertung für viele Kanäle (24/32 Bit, alle Kanäle und Paare, Klick gegen Klick, Uhrkorrektur K2)
- [ ] Messleitstand: ein Befehl je Lauf (Rollen setzen, Aufnahme + Instrumentierung starten, Play, Stop, benennen, auswerten, Protokoll, Ausgangszustand wiederherstellen)
- [ ] Instrumentierung je Gerät (Uhrabgleich, Songzeit gegen Audio-Position, CPU, WLAN, Akku, Bildschirm)
- [ ] Störungs-Auswertung (S6)
- [ ] Cue-Piepser: hört auf einen MIDI-Eingang (UM-ONE bzw. UMC204HD), piept beim Empfang auf einem eigenen Laptop-Ausgang; kann umgekehrt zu bekannten Zeiten MIDI senden und dabei piepen (M3)
- [ ] Prüfen, wie Server-Cues heute ausgegeben werden; für M1 ein MIDI-Ausgang des Servers für einen Test-Cue (kleines Test-Plugin, falls nötig)
- [ ] Test-Cues im Referenz-Song auf das MIDI-Testgerät (Takt 9, 17, 29, 53)
- [ ] OSC-Testprogramm (L2b): sendet zu bekannten Zeiten eine OSC-Nachricht an den Maestro und piept dabei
- [ ] DMX-Testprogramm (L0): erzeugt die DMX-Rahmen über den FTDI-Wandler, schaltet den Dimmer zu bekannten Zeiten und piept dabei; misst auch die tatsächliche Rahmenrate
- [ ] Auswertung Lichtsensor: Einsatz des Lichts (Flanke, PWM-Flimmern geglättet) gegen Piep bzw. Schlag; für Bildschirme auch die Bildwechsel-Raster (60 Hz)
- [ ] Bericht (Tabellen, Diagramme, Freigabe-Matrix) als Seite
- [ ] Trockenlauf aller Werkzeuge mit der Laptop-Ausgabe (ohne Pult, ohne Ton; Laptop-Bildschirm entsperrt)

### Phase 2 - Hardware vorbereiten (Marco, ca. 1,5 h, vor Testtag 1)

**Ui24R**
- [ ] Firmware-Version notieren
- [ ] Neue Szene „StageBoard Messung“: Kanäle 1–8 ohne EQ, Kompressor, Gate, Hochpass, Effekte; Phantomspeisung aus; Fader egal
- [ ] Ui24R per USB an den Laptop, Claude prüft, **wie viele Kanäle** der Laptop sieht und ob es die Eingänge **vor** der Bearbeitung sind (falls nur 2 Kanäle: Plan B §8)
- [ ] Kabel beschriften (Kanalnummer = Gerät, Tabelle §7.2)

**UMC204HD**
- [ ] Am Laptop anschließen - Claude prüft Erkennung (Ein- und Ausgänge)
- [ ] An jedes Tablet/Handy über den USB-C-Hub mit Laden: wird es erkannt? (Ton aus einer beliebigen App kommt am UMC heraus?) Ergebnis je Gerät notieren
- [ ] MIDI: UMC204HD am Laptop - Claude prüft, ob MIDI In/Out als Port erscheint; Schleife UMC Out → UM-ONE In testen
- [ ] MIDI am Tablet: UMC204HD über den Hub am Tablet - erscheint der MIDI-Port in StageBoard (System → Hardware), im **Browser** und in der **App**? Ergebnis je Gerät notieren

**Geräte (je Tablet/Handy)**
- [ ] Entwickleroptionen an (7 × auf Build-Nummer), **USB-Debugging an**, „Wach bleiben (beim Laden)“ an
- [ ] Akku-Optimierung für Chrome und StageBoard-App aus; adaptiver Akku / Energiesparen aus
- [ ] Bluetooth aus (außer für S12), Nicht stören an, System- und Tastentöne aus
- [ ] Medienlautstärke auf festen Wert (Vorschlag 50 %), Lautstärke-Begrenzung (EU-Hörschutz) beachten
- [ ] StageBoard-App aktualisieren (Einstellungen → App → Nach Update suchen) und im Browser die Seite öffnen
- [ ] Referenz-Song lokal vorhanden (Einstellungen → Speicher & Sync)
- [ ] Gerätename in StageBoard eindeutig (z. B. „Xiaomi-Tablet“)
- [ ] Modell, Android-Version, Chrome-/WebView-Version notieren (Claude liest es per USB aus)

**Licht (S17)**
- [ ] usangreen-Wandler am Laptop anstecken - Claude prüft Erkennung (FTDI) und baut das Testprogramm L0
- [ ] U'King Moving-Head: Kanalmodus und Adresse notieren, Dimmer-/Shutter-Kanal heraussuchen (Handbuch)
- [ ] Drei Lichtsensoren bauen (Anleitung §4.7) und mit Taschenlampe am Ui24R prüfen
- [ ] Maestro DMX: neueste Software, MIDI-Zuordnung (Note/PC → Szene „an“/„aus“) und OSC-Adresse für dieselbe Szene einrichten; IP-Adresse und OSC-Port notieren
- [ ] QLC+: MIDI-Eingangsprofil (Note → Szene „an“/„aus“) und Ausgabe über den usangreen-Wandler

**Netz**
- [ ] Router wie auf der Bühne, alle Geräte im selben WLAN (Band notieren: 2,4/5 GHz)

### Phase 3 - Dell als Stage-Server (eigener Termin)

- [ ] Marco: Ubuntu Server 24.04 LTS installieren (oder Desktop), Benutzer anlegen, ins Netz, SSH an, IP an Claude
- [ ] Claude: Docker + CouchDB, Node (nvm), StageBoard-Dienst (systemd), Zertifikate (Schlüssel nur für den Benutzer), mDNS-Name, Backup-Ziel, Firewall
- [ ] Claude: Band umziehen oder Testband anlegen (Entscheidung Marco)
- [ ] Geräte auf den Dell umstellen, Kurzprüfung S3

### Phase 4 - Probelauf (gemeinsam, ca. 1 h, z. B. am Anfang von Testtag 1)

- [ ] Aufbau nach §7, alle Kabel gesteckt
- [ ] S0 Kalibrierung komplett (K1–K7) - **muss bestehen**
- [ ] Ein Lauf S2 auf einem Gerät, Auswertung live ansehen
- [ ] Protokoll und Dateiablage prüfen

### Phase 5 - Testtage (Ablauf docs/17 §12)

- [ ] Testtag 1: Blöcke A–C (S0, S1, S2, S3, S4, S5, S16)
- [ ] Testtag 2: Blöcke D–F (S11, S6, S7, S8, S9, S10, S12, S13)
- [ ] Dell-Termin: S15, S14 (Langlauf)

### Phase 6 - Auswertung, Ausgleich, Nachweis

- [ ] Bericht mit Freigabe-Matrix (§9)
- [ ] Entscheidung, welche Maßnahmen umgesetzt werden (Entscheidungsbaum docs/17 §11)
- [ ] Umsetzung (Ausgleich je Gerät #302, Track-Nachführung, Geräteprofil #303 …)
- [ ] **Nachmessung** derselben Szenarien mit Ausgleich - erst dann gilt ein Aufbau als freigegeben
- [ ] Hörtest mit der Band auf dem besten und dem schlechtesten freigegebenen Aufbau

## 7. Aufbau am Testtag

### 7.1 Ablauf

1. Pult, Laptop, Router aufstellen, alles am Strom.
2. Ui24R-Szene „StageBoard Messung“ laden.
3. Ui24R per USB an den Laptop; Claude startet die Aufnahmeprobe.
4. Geräte am Strom, per USB am Laptop (Debugging), Kabel nach §7.2 ins Pult.
5. Pegel: jedes Gerät spielt 8 Takte Referenz-Song; Gain so, dass die Pieps bei ca. −12 dBFS liegen, nichts über −6 dBFS.
6. Probelauf (Phase 4).

### 7.2 Kanalbelegung Ui24R

| Kanal | Quelle | Weg |
|---|---|---|
| 1 | Xiaomi-Tablet | P1 Kopfhörer |
| 2 | Xiaomi-Handy | P2 USB-C-Adapter |
| 3 | Fire HD 10 | P1 Kopfhörer |
| 4 | Samsung S26 | P2 USB-C-Adapter |
| 5 | Laptop (Chrome, Server-Uhr) | Kopfhörer - absoluter Bezug |
| 6 | UMC204HD Ausgang 1 (Tablet über P3) | TRS |
| 7 | Cue-Piepser (MIDI-Empfang/-Senden) | Laptop-Ausgang 2 bzw. UMC204HD-Ausgang 2 |
| 8 | Kalibrierung (Y-Kabel), bei M4 das echte Effektgerät | Y-Kabel / Geräteausgang |
| 9 | Lichtsensor Scheinwerfer (S17) | Fotodiode, Phantom aus |
| 10 | Lichtsensor Bildschirm A (S10) | Fotodiode, Phantom aus |
| 11 | Lichtsensor Bildschirm B (S10) | Fotodiode, Phantom aus |
| 12 | Fender Mustang Micro Plus (S12, Bluetooth) | Kopfhörerausgang 3,5 mm, Pegel niedrig anfangen |

Für S16 wechselt jeweils **ein** Tablet von Kanal 1/3 auf das UMC204HD (Kanal 6), damit P1 und P3 desselben Geräts direkt verglichen werden.

## 8. Plan B, falls etwas nicht geht

| Problem | Ausweg |
|---|---|
| Ui24R liefert per USB nur 2 Kanäle | Ui24R nimmt **mehrspurig auf USB-Stick** auf (alle Kanäle, eine Uhr), Dateien danach auf den Laptop; oder Messungen paarweise über das UMC204HD (2 Kanäle) |
| UMC204HD wird von einem Tablet nicht erkannt | Ergebnis notieren (Aufbau P3 für dieses Gerät „geht nicht“), weiter mit P1 |
| Brummen | Masseschleifen-Trenner; Laptop vom Netzteil trennen (Akku) |
| Gerät schläft ein | Wach-bleiben-Einstellung, am Strom; Lauf wiederholen |
| WebMIDI am Tablet geht nicht (z. B. in der App) | Ergebnis notieren; M2/M3 im Browser messen; für die App eine native MIDI-Brücke als eigenes Thema |
| Server-Cues gehen nicht über MIDI hinaus | M1 mit einem kleinen Test-Plugin auf dem Server; sonst M2 als Ersatz |
| Auswertung findet Pieps nicht | Pegel prüfen, Kanal neu zuordnen; Rohaufnahme bleibt erhalten |

## 9. Ergebnis: was am Ende herauskommt

### 9.1 Kennzahlen je Aufbau

Für jede Kombination aus Gerät, Ausgabeweg, Modus und Rolle:

- **Versatz** Klick minus Track (Median) mit **Spanne über die Läufe**
- **Streuung** im Abschnitt, **Drift**, **Sprünge**
- **Abstand zu den anderen Geräten** (Matrix)
- **Lage gegen die Songzeit** (absolut, ±5 ms)
- **Erholung nach Störungen**
- **Cue-, MIDI-, Licht- und Bild-Latenz** (M1 Server → Gerät, M2 Tablet → Gerät, M3 Pedal → App, L0–L3 Licht)
- Erklärung aus der Instrumentierung (z. B. „Sprünge fallen mit WLAN-Einbrüchen zusammen“)

### 9.2 Freigabe-Matrix

| Bewertung | Bedeutung |
|---|---|
| **grün - geht** | innerhalb der Grenzwerte „gut“ ohne Ausgleich |
| **gelb - geht mit Ausgleich** | Versatz konstant und reproduzierbar (Spanne über Läufe ≤ 5 ms) → mit einem festen Ausgleichswert je Gerät/Weg innerhalb „gut“ |
| **orange - eingeschränkt** | nur für bestimmte Rollen (z. B. Prompter ja, Klick-Ausgabe nein) |
| **rot - geht nicht** | streut oder springt so, dass kein fester Ausgleich hilft |

### 9.3 Ausgleich: wann er funktioniert

Ein Ausgleich (Klick oder Track um einen festen Wert vorziehen) funktioniert nur, wenn der Versatz **konstant** ist. Deshalb zählt neben dem Mittelwert vor allem die **Wiederholbarkeit**: Spanne über die drei Läufe, über einen Neustart der App und über einen Neustart des Geräts. Der Test liefert diese drei Zahlen je Aufbau. Ist sie klein, wird der Wert ins Geräteprofil (#303) eingetragen und der Ausgleich (#302) gebaut; danach Nachmessung.

### 9.4 Was wir danach sicher sagen können - und was nicht

- **Sicher:** für unsere Geräte und Aufbauten, ob sie synchron genug sind, mit welchem Ausgleich, und welche Wege (Klinke, USB-C, Interface, Bluetooth) taugen.
- **Mit Vorbehalt:** für andere Geräte desselben Typs (gleiches Modell, andere Android-Version).
- **Nicht:** für unbekannte Geräte - dafür der Referenz-Song in der App als Selbsttest.

## 10. Kurzfassung der nächsten Schritte

1. Marco: Fragen beantworten, Einkauf §3.2, Termine.
2. Claude: Werkzeuge Phase 1 bauen und trocken testen.
3. Marco: Phase 2 (Ui24R-Szene, UMC-Prüfung, Geräte einstellen).
4. Gemeinsam: Testtag 1, Testtag 2, Dell-Termin.
5. Claude: Bericht, Freigabe-Matrix, Ausgleich, Nachmessung.
