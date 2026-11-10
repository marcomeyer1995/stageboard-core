# Audio-Ausgabe für alle Geräte: Wege, Zeitstempel, Ausgleich

Konzept, Stand 2026-11-05, kein Beschluss im Detail. Anlass: Marco hat Klick und Track auf allen Tablets gleichzeitig gehört (#695) – Redmi, Laptop und Handy klingen zusammen, der Fire liegt hörbar daneben. Gemessen mit dem Laptop-Mikrofon: der Fire ist **360 ms** nach dem Redmi zu hören, seine eigenen Zeitstempel sagen nur ~180 ms (docs/29 §11). Baut auf docs/28 (getrennte Ausgänge, eigener USB-Treiber) und docs/29 (eine Zeitbasis) auf.

## 1. Entscheidungen (Marco, 2026-11-05)

- **Für alle Geräte am Markt, nicht für die Geräte im Haus.** Kein Weg, der nur auf dem Fire oder nur auf MediaTek passt; eine große Gemeinschaft soll ihre eigenen Tablets und Handys benutzen können.
- **Beide nativen Wege anbieten:** Androids eigener Treiber (AAudio) und unser eigener USB-Treiber (docs/28 §4). Der Browser-Weg (Web Audio) bleibt für alles andere.
- **Ausgleich immer möglich, am besten nie nötig:** jeder Weg kann um eine gemessene Verzögerung früher spielen; Ziel ist ein Weg, dessen Zeitangabe stimmt, sodass nichts eingemessen werden muss.
- **So wenig Zusatzhardware wie möglich:** eigene Hardware, Spezialkabel auf der Bühne sind ein Grund, die App nicht zu kaufen. Gemessen wird mit dem, was eine Band hat (Pult, Handys, Laptop); auf einer lauten Bühne muss es trotzdem verlässlich sein.
- **Abgleich von Hand** ohne jedes Gerät gehört dazu: ein Regler in ms, einstellen nach Gehör oder Auge gegen eine Referenz (docs/21 §4).
- **Die ganze Mischung geht nativ raus** („pipe“, nicht nur der Klick) – sonst lägen Klick und Track auf dem Fire um den WebView-Fehler auseinander (§2b).
- **Native Ausgabe auf Android standardmäßig an**, je Gerät abschaltbar (nach dem Hörtest, PR #699).

## 2. Was wir wissen

| Gerät · Weg | Puffer bis hörbar | stimmt die Zeitangabe? | Quelle |
|---|---|---|---|
| Fire HD (Android 9) · WebView | ~240 ms laut Zeitstempel, **~420 ms gehört** | nein: ~180 ms zu wenig, dazu Ausreißer (bis 13 s, −17…−32 ms) und Spitzen bei Stop | docs/29 §11 |
| Fire · AAudio (fester Ausgang) | ~114 ms | nicht gemessen | docs/28 §2 |
| Fire · AAudio, Lautsprecher | ~210 ms (kein Low-Latency-Pfad, Burst 960) | **ja** – gehört wie Redmi/Handy (§2a) | §2a |
| Redmi · AAudio, Lautsprecher | ~31 ms (Low-Latency, Burst 256) | ja | §2a |
| Xiaomi-Handy · AAudio und WebView | ~30 ms | ja, beide Wege gleich (±2 ms) | §2a |
| Redmi Pad SE · WebView, Lautsprecher | ~35–60 ms | ja (bis auf jedes zehnte Paar +5 ms) | docs/29 §11 |
| Redmi · USB über Androids Treiber | – | stumm, meldet „läuft“ (MediaTek-HAL) | docs/28 §3 |
| Redmi · eigener USB-Treiber | Rundlauf 3 ms | ja (wir zählen die Samples selbst) | docs/28 §5 |
| Laptop · Chrome | ~48 ms | ja (±2 ms) | docs/29 §11 |

### 2a. Messung nativer Klick (2026-11-05, Schritt 1 aus §6)

Spike `spike/native-click` (App 1.712): ein Klick über AAudio, gelegt auf ein 1-s-Raster der Server-Zeit; die Lage jedes Puffers kommt aus AAudios eigenem Zeitstempel (`getTimestamp`: Bildposition + Abspielzeit), **ohne jeden Ausgleich**. Gleichzeitig spielt jedes Gerät denselben Klick über Web Audio (Lage aus `getOutputTimestamp`, wie die App heute). Jeder Klick hat eine eigene Tonhöhe, das Laptop-Mikrofon nimmt alles auf. 6 Runden, vor jeder die App auf allen Geräten neu gestartet. Werte in ms gegen den nativen Fire-Klick:

| Runde | Fire WebView | Redmi nativ | Redmi WebView | Handy nativ | Handy WebView |
|---|---|---|---|---|---|
| 1 | +161 | −10 | −8 | −9 | −9 |
| 2 | +159 | +15 | +16 | −11 | −11 |
| 3 | +161 | −14 | −15 | −14 | −12 |
| 4 | +159 | −10 | −11 | −12 | −11 |
| 5 | +161 | −4 | −2 | −12 | −12 |
| 6 | +160 | −9 | −9 | −12 | −11 |

- **Nativ liegen alle drei Geräte ohne Ausgleich innerhalb ~10–15 ms**; ein Neustart nur des Audio-Streams ändert die Lage um ~2 ms (8 Neustarts Fire/Handy: −8,5…−10,6 ms), Schwankung von Schlag zu Schlag 1–2 ms.
- **Fire-WebView** liegt je App-Start mal 24 ms, mal 160 ms daneben – nicht ausgleichbar. Fire nativ dagegen stimmt.
- **Redmi und Handy:** WebView = nativ ±2 ms, die Browser-Zeitangabe stimmt dort.
- **Der Rest ist die Uhr, nicht das Audio:** beim Redmi springen nativ und WebView gemeinsam (+15 / −4 / −14) – das ist der Versatz der Uhr-Synchronisation nach dem App-Start (der Spike nutzt nur die rohe Uhr-Synchronisation, nicht den Zeitdienst aus docs/29).
- Die konstanten ~10 ms Fire gegen die anderen: Abstand zum Mikrofon oder nicht gemeldete Lautsprecher-Verzögerung – offen, der Abgleich von Hand deckt es ab.

Daten und Skripte: `~/stageboard-data/sync-bench/2026-11-05-native/`.

### 2b. Im Gig: die ganze Mischung über die native Ausgabe (2026-11-05, PR #697)

Marcos Entscheidung: nicht nur der Klick, sondern **die ganze Mischung** geht nativ raus ("pipe") – sonst lägen Klick (nativ) und Track (WebView) auf dem Fire um den WebView-Fehler auseinander. Ein AudioWorklet greift die Mischung ab, ein Worker schickt sie über einen WebSocket auf 127.0.0.1 an einen AAudio-Stream, der jeden Frame zur Zeit „gerendert + feste Verzögerung“ abspielt (Fire 410 ms, Redmi/Handy 231 ms). Messung im Gig mit dem Referenz-Song, jedes Gerät klickt in eigener Tonhöhe (`sb:debug:click-hz`), Bezug Laptop-Chrome:

| | WebView | native Ausgabe |
|---|---|---|
| Fire gegen Laptop | −107…−114 ms | −15…−17 ms |
| Redmi gegen Laptop | +24…+32 ms | −25…−31 ms |
| Handy gegen Laptop | +1…+6 ms | −27…−30 ms |

Schwankung von Schlag zu Schlag 0,5–2 ms, keine Aussetzer bei Play/Stop. Lehren unterwegs: Übergabe über die Capacitor-Brücke vom Haupt-Thread setzte bei Play/Stop aus (Haupt-Thread 200–350 ms blockiert) → Worker + WebSocket; einzelne Frames überspringen knackte → Tempo um höchstens 0,2 % anpassen; Capacitors `getDouble()` liefert 0 für große ganze Zahlen; Android blockiert `ws://127.0.0.1` ohne Cleartext-Ausnahme. Offen: Sprünge auf dem Handy bei Play/Stop, die konstanten ~12 ms Fire gegen Redmi/Handy, längere Reaktion auf Stop am Fire.

### 2c. Uhr nach dem App-Start und Restausgleich (2026-11-05, PR #698, #699)

**Uhr:** gegen die echte Geräte-Uhr über USB gemessen (Gerät gibt alle 20 ms seine Uhr über adb aus, kleinste Ankunfts-Differenz = Versatz; je 4 App-Starts × 3 min). Die Band-Zeit des Redmi lief 45–150 s nach dem Start bis 68 ms weg. Drei eigene Rechenfehler, kein Gerätelimit: Drift-Linie durch zu wenige Samples (jetzt ab 60 s, höchstens 100 ppm), die Burst-Samples (direkt hintereinander, auf dem Redmi ~40 ms daneben) zählten im Fenster mit (jetzt nicht mehr), und während der Audio-Downloads nach dem Start (docs/11) lagen langsame Anfragen bis 1,5 s daneben (jetzt zählen nur Samples höchstens 20 ms langsamer als das schnellste). Danach alle drei Geräte ab ~40 s innerhalb −2…+6 ms, Fire und Handy meist ab der ersten Sekunde.

**Restausgleich:** auch mit nativer Ausgabe blieb ein fester Rest, den kein Gerät meldet – Fire 15 ms nach Redmi/Handy (Lautsprecher), Laptop-Chrome 30 ms. Eigener Profil-Ausgang `audio-native` je Gerät und Route (im Latenz-Dialog „Ton über die native Ausgabe“), zur nativen Verzögerung addiert. Gesetzt: Fire 15 ms, Laptop 30 ms (sein WebView-Wert). Danach gegen den Laptop-Klick: Fire 0…+3 ms, Redmi −3…+2 ms, Handy ~0; Marco: „sounds good“.

**Messfalle:** liegen die Klicks zusammen, verdecken sie sich im Mikrofon (der leisere wird nicht mehr erkannt). Zum Prüfen jedem Gerät einen bekannten Versatz geben (über die Profile), danach abziehen.

### 2d. Von Song zu Song stabil (2026-11-05, PR #701)

Gemessen mit Song-Starts im Gig (Mikrofon ab 1,5 s vor Play, jedes Gerät eigene Klick-Tonhöhe `sb:debug:click-hz`, Track stumm, Play über `__sbRunAction`), Uhr parallel über USB gegen die Wahrheit:

- **Verschobene Klicks nach Play (Fire):** die native Ausgabe startete erst mit dem ersten Ton und brauchte ~0,5 s – die ersten Schläge lagen noch auf der WebView-Uhr. Jetzt Start beim App-Start (`useNativeOutputWarmup`).
- **Die WebView-Uhr driftet:** `currentTime` läuft gegen die Wand-Uhr 0,8 ms/s (Redmi) bis 1,2 ms/s (Handy) langsamer, unter Last mehr. Die Zeitlinie lief mit höchstens 0,5 ms/s hinterher und sprang bei 20 ms. Jetzt: Gerade durch die früheste Ankunft jeder Sekunde der letzten Minute (Steigung Theil-Sen, Höhe an der frühesten – eine Ankunft ist nie zu früh); Sprung erst ab 100 ms; in der ersten Minute nach dem Start übernimmt sie die Kante sofort.
- **Drift zwischen den Songs:** nicht die Uhr (über USB stabil), sondern die Tempo-Regelung: rein proportional brauchte sie zum Folgen eine bleibende Abweichung von 2–4 ms, die mit der Last wechselte. Jetzt PI (Integral 20 s, höchstens 0,4 %).
- **Redmi-Zeitstempel** liegen immer wieder kurz ~5 ms daneben: als Sprung erst nach 500 ms.

| 8 Song-Starts, gegen Redmi | vorher | nachher |
|---|---|---|
| Handy | −5 … −16 ms | −2 … −5 ms |
| Laptop | −4 … −19 ms | −4 … −7 ms |
| Fire | −4 … −11 ms | −4 … −5 ms |

**Messfallen:** gleichzeitige Klicks verdecken sich im Mikrofon (Abhilfe: eigene Tonhöhen, bekannter Versatz); ein Lautsprecher direkt am Mikrofon auf 100 % übersteuert und klingt nach (Laptop für Messungen auf 40 %); Tablet-Lautstärke 0 schaltet nicht jedes Gerät stumm.

Daraus:

1. **Die Browser-Zeitangabe ist geräteabhängig verlässlich** – auf zwei von drei Geräten gut, auf dem Fire falsch. Das lässt sich in der App nicht reparieren, nur erkennen und ausgleichen.
2. **„Nativ“ heißt nicht „schnell“:** AAudio auf dem Fire hat 114 ms – der Hersteller bestimmt den Weg. Auf Geräten mit Androids Low-Latency-Pfad (`android.hardware.audio.low_latency`, Pro-Audio) sind 10–20 ms üblich.
3. **Herstellertreiber können still versagen** (Redmi-USB). „Erkannt“ heißt nicht „spielt“, „läuft“ heißt nicht „zu hören“.
4. **Nur was wir selbst messen, gilt.** Die Zeitangabe eines Wegs ist eine Behauptung, bis sie einmal gegen ein Mikrofon geprüft ist.

## 3. Aufbau

Eine **Audio-Engine** mit austauschbaren **Ausgabewegen**. Alle Wege beantworten dieselbe Frage: *Welches Sample ist zu welcher Zeit der gemeinsamen Uhr zu hören?* – die Engine plant Klick, Track, Stems und Ansagen auf der Band-Zeit (docs/29) und schreibt sie in den Weg.

| Weg | wo | Zeitangabe | Kanäle |
|---|---|---|---|
| **Web Audio** | überall (Browser, WebView, iPad, Laptop) | `getOutputTimestamp()` über den Zeitdienst (docs/29) | 2 |
| **AAudio** (über Oboe) | Android 8.1+ | `AAudioStream_getTimestamp(CLOCK_MONOTONIC)`: Frame-Position ↔ Zeitpunkt des Hörens laut HAL | wie das Gerät, Index-Maske für getrennte Kanäle |
| **Eigener USB-Treiber** | Android mit USB-Host, class-compliant Interfaces (UAC1/UAC2) | eigene Sample-Zählung + Feedback-Endpunkt; Rest ist der Wandler (~1 ms) | alle des Interfaces |

- **Die Engine läuft dort, wo der Weg ist:** für die nativen Wege in C++ (Mixer, Klick-Synthese, Track/Stems aus dekodiertem PCM, Rate-Anpassung für die Drift wie heute), gesteuert von der App über einen Zeitplan („Song-Zeit X ist Band-Zeit Y, Tempo, Stummschaltungen“) – nicht Sample für Sample über die Brücke.
- **Eine Uhr:** jeder Weg liefert Paare (eigene Position ↔ `CLOCK_MONOTONIC`); die App kennt `performance.now()` ↔ `CLOCK_MONOTONIC` (gleiche Uhr auf Android, einmal geprüft) und damit die Band-Zeit. Derselbe robuste Zeitdienst (dichtestes Band, Rate als Median, docs/29) wertet sie aus – egal von welchem Weg.
- **Auswahl je Ausgang, nicht je Gerätemodell:** die App bietet an, was das Gerät kann, und wählt nach der Geräteprüfung (§4) den besten Weg vor; der Musiker kann umstellen.

## 4. Messen statt glauben: die Geräteprüfung

Wie gemessen wird - mit möglichst keiner Zusatzhardware, auch auf einer lauten Bühne - steht für alle Ausgänge (Ton, Licht, Video, Amp-Modeller) in **docs/21 §4 „Stufen ohne Zusatzhardware“**: Abgleich von Hand nach Gehör/Auge als Grundbaustein, das Mischpult als Sensor für alle Audio-Ausgänge gleichzeitig, die Handy-Kamera für Licht, das Mikrofon nur im Proberaum, Loopback für Interfaces. Für die Audio-Ausgabe heißt das:

1. **Urteil je Weg:** stimmt die Zeitangabe (Abweichung ≤ 2 ms), braucht der Weg keinen Ausgleich. Weicht sie fest ab, wird der Unterschied als Ausgleich gespeichert. Schwankt sie von Start zu Start (Fire-WebView: bis 30 ms je App-Start), sagt die App das offen („Ausgang ungenau, ±30 ms“) und empfiehlt einen anderen Weg - eine Kalibrierung hilft dort nicht.
2. **Ein Wert gilt je Gerät und Weg** (Lautsprecher, Kopfhörer, Bluetooth, Interface - `AudioRoutePlugin`), im Proberaum gemessen oder nach Gehör eingestellt; am Ort nur die Kurzprüfung.
3. **Gemeinschaft:** die Ergebnisse (Modell, Android-Version, Weg, behauptet vs. gehört, Schwankung) können anonym geteilt werden - eine Tabelle, welches Gerät auf welchem Weg taugt. Neue Musiker bekommen einen Startwert, bevor sie selbst messen. (Freiwillig; Datenschutz und Server dafür offen, docs/16.)

## 5. Ausgleich

Wie heute (#491, docs/21 §9): ein Weg spielt um seinen gemessenen Rest früher. Neu ist, wofür er steht: **nur den Unterschied zwischen Zeitangabe und Gehörtem** – bei einem Weg mit stimmender Zeitangabe ist er 0, und die Pufferlänge selbst muss niemand mehr einmessen, weil die Zeitangabe sie enthält. Bei Funkstrecken (In-Ear-Sender, Bluetooth) und Mischpulten bleibt ein Rest, den nur eine Messung kennt – dafür bleibt die Möglichkeit immer da.

## 6. Reihenfolge

1. ✅ (2026-11-05, §2a) **AAudio-Spike als Ausgabeweg für den Klick** – auf allen Geräten im Haus (Fire, Redmi, Xiaomi-Handy), nicht nur dem Fire: Klick nativ, geplant auf der Band-Zeit, Zeitangabe über `getTimestamp`. Gemessen mit dem Laptop-Mikrofon wie heute: behauptet vs. gehört, Schwankung je Start, Abstand zu den anderen Geräten. Erst wenn das auf allen dreien hält, weiter.
2. ✅ (2026-11-05, §2b, PR #697) **Ausgabe nativ:** statt einer nativen Engine geht die fertige Mischung der WebView über einen Worker und einen Loopback-WebSocket an AAudio („pipe“) – Track, Stems, Zeitdehnung bleiben, wie sie sind.
3. **Eigener USB-Treiber als zweiter nativer Weg** in dieselbe Engine (docs/28 §6, Eingang zuerst stabil).
4. **Geräteprüfung** (§4, docs/21 §4): Abgleich von Hand zuerst (keine Hardware), dann Mischpult und Loopback automatisch; Urteil je Weg, Ausgleich nur wo nötig; Anzeige in Bühnentechnik.
5. **Gemeinschafts-Tabelle** (§4.3), wenn es Nutzer außerhalb gibt.
6. Später: iOS (AVAudioEngine mit `outputLatency`/Host-Zeit – derselbe Gedanke), Windows/macOS für den Laptop-Host (docs/25).

## 7. Offen

- Handy: Schwankung von Schlag zu Schlag höher als bei den anderen (in einzelnen Aufnahmen 8–12 ms), Sprünge > 20 ms bei Play/Stop.
- Fire: in einer Aufnahme einige verschobene Klicks in den ersten Sekunden nach Play.
- Der Restausgleich (`audio-native`) gilt je Route – mit Kopfhörer braucht der Fire einen eigenen Wert (Abgleich nach Gehör, PR #700).
- Ein Redmi-Start blieb 30 s bei −20 ms: während der Audio-Downloads nach dem Start kommen kaum schnelle Uhr-Anfragen durch (docs/11).
- Zwischen Song-Starts bleiben ~3 ms Streuung; die Uhr-Synchronisation ist jetzt der größere Rest.
- **Idee (Marco, 2026-11-06: nur notieren):** Die gelernte Extra-Reserve der nativen Ausgabe (`sb:audio:native-output-extra`) wächst nur (+50 ms je knappem Moment) und schrumpft nie – Drehen, Sperren, der 17-h-Lauf haben sie dauerhaft erhöht (Handy 200 ms, Redmi 150 ms, Fire 50 ms). Im Dauerlauf 2026-11-06 (1 h) blieb trotzdem immer Reserve übrig: kleinste Fire 149 ms, Redmi 131 ms, Handy 235 ms. Vorschlag: nach 30 min sauberem Spielen beim nächsten Start 50 ms weniger, nie unter 0. Gewinn: kürzerer Play-Vorlauf, kürzeres Warten von MIDI/Licht auf den Ton. Risiko: Pendeln bei Geräten, die selten knapp werden.

- Oboe als Fremdbibliothek (Apache 2.0) oder AAudio direkt? Oboe bringt Rückfall auf OpenSL ES für Android < 8.1 und viele Geräte-Umgehungen – Vorschlag: Oboe.
- Track-Daten in die native Engine: dekodiert über die Brücke (einfach, Speicher) oder nativ dekodieren (MediaCodec)?
- Welche Pulte geben ihre Eingänge per USB/Netz so heraus, dass StageBoard sie lesen kann (USB-Audio class compliant vs. eigene Treiber/Protokolle)? Zuerst die Pulte, für die es schon Plugins gibt (CQ-18T, Ui24R).
- Was zeigt die App, wenn kein Weg auf einem Gerät stimmt (der Fire-WebView-Fall)? Vorschlag: rotes „Ausgang ungenau“ in Bühnentechnik mit der gemessenen Schwankung, Empfehlung eines anderen Wegs.

## 8. Native Engine statt Pipe (Konzept 2026-11-06; Entscheidungen 2026-11-10 in §8h)

Heute rechnet die **WebView** den Ton (Track, Stems, Klick, Ansagen, Mischung), die native Ausgabe spielt nur das fertige Ergebnis zur richtigen Zeit (§2b, „pipe“). Eine **native Engine** würde den Ton selbst im App-Prozess rechnen (C++, Oboe/AAudio-Callback); die WebView schickt nur noch Befehle („Song X, Start bei Band-Zeit T, Klick 120 %, Sprung zu Teil B“). §3 beschreibt das schon als Ziel; im November wurde bewusst zuerst die Pipe gebaut.

### 8a. Anlass

Alle Fehler eines Tages (2026-11-06) kamen aus dem Rechnen in der WebView, keiner aus der Ausgabe:

| Gerät | was | Folge |
|---|---|---|
| Handy nach 17 h | WebView rechnete 0,2–0,6 % langsamer als Echtzeit, Hänger bis 128 ms | 20 % Ton fehlte |
| Handy, Wärmedrosselung | ganzes System 2,6 s still | 1,6 s Ton fehlte |
| Redmi, Drehen | Audio-Uhr der WebView ~0,5 s angehalten | Linie eine Minute falsch (behoben, PR #708) |
| Redmi, Sperre | Seite verborgen, danach Nachliefern | Klick und Ansagen stehen absichtlich, danach Aussetzer |
| Fire | Hauptfaden 600 ms je Takt blockiert (Show-Log, PR #709) | Betonung fehlte jeden Takt |
| alle | Pipe braucht 281–483 ms Verzögerung | Vorlauf nach Play 800 ms (PR #710) |

### 8b. Was nativ besser wäre

- **Läuft weiter bei gesperrtem Bildschirm/im Hintergrund** (mit einem Vordergrund-Dienst und Benachrichtigung) – z. B. das Handy in der Tasche als In-Ear-Zuspieler.
- **Unabhängig von WebView, Darstellung, JavaScript und Speicherbereinigung:** ein Audio-Faden mit höchster Priorität; Drehen, ein voller Bildschirm oder ein blockierter Hauptfaden halten ihn nicht auf.
- **Kleine Verzögerung:** ~20–40 ms statt 281–483 ms – der Vorlauf nach Play könnte auf ~200–300 ms sinken.
- **Nichts zu schätzen:** der Ton wird direkt auf die Uhr der Ausgabe gelegt; die Zeitlinie (Schätzung der WebView-Uhr, die 0,1–0,6 % abweicht) entfällt.
- **Mehrere Ausgänge** (Klick ins In-Ear, Track zur PA über ein USB-Interface, docs/28, docs/31) direkt möglich.

### 8c. Was es kostet

- **Großer Umbau:** alles, was die Web-Audio-Engine heute kann, braucht eine native Fassung – Dekodieren, Zeitdehnung (Loop-Trainer, Tempo; Signalsmith gibt es in C++), Stems, Teil-Sprünge mit Überblendung, Mischung, Ansagen.
- **Zwei Engines:** Laptop, Browser und später iOS behalten Web Audio. Beide müssen sich gleich verhalten – mehr Tests, mehr Möglichkeiten für Unterschiede.
- **Nur Android** zuerst, schwerer zu testen als der Web-Code.

### 8d. Vorschlag: in Stufen, das Zeitkritischste zuerst

1. **N1 – Klick und Ansagen nativ.** Klein und am zeitkritischsten. Je Song bekommt die native Seite einmal den Plan: Schlagzeiten aus dem Raster in Band-Zeit, Betonungen, Stummschaltungen, die Ansage-Clips (WAV) mit ihren Zeiten, die Pegel; danach nur Ereignisse (Play, Pause, Sprung, Tempo). Der Track kommt weiter über die Pipe und wird nativ dazugemischt – ein Ausgang. Damit: Klick und Ansagen unabhängig von allen Hängern oben, auch bei gesperrtem Bildschirm.
2. **N2 – Track und Stems nativ,** wenn N1 auf der Bühne trägt: Dekodieren (MediaCodec oder dekodiert über die Brücke), Zeitdehnung, Sprünge. Danach entfällt die Pipe.
3. **N3 – mehrere Ausgänge** nach der Bühnenkarte (docs/31) und dem eigenen USB-Treiber (docs/28).

Was bleibt: die Band-Zeit (docs/29), der Ausgleich je Weg (§5, docs/31), Web Audio für Browser und iOS, die Geräteprüfung (§4).

### 8e. Wie geprüft wird

- **Zeitstempel-Mitschnitt** wie am 2026-11-06 (jeder Klick, jede Ansage in Band-Zeit auf allen Geräten): N1 mindestens so genau wie die Pipe.
- **Störtests:** Drehen, Sperren, Wärme (lange laufen lassen), schwerer Bildschirm (Bibliothek scrollen), 3 h am Stück – kein fehlender Klick.
- **Gleiche Ergebnisse beider Engines:** derselbe Plan offline in beiden gerechnet, Klickzeiten und Pegel verglichen (Testvektoren im Repo).

### 8f. Entschieden (Marco, 2026-11-06)

- **Bei gesperrtem Bildschirm spielt es weiter.** Mit der WebView geht das nicht sauber – im Hintergrund bekommt sie nur noch vereinzelte Timer-Takte, daher stoppt der Klick dort heute absichtlich (lieber synchron als unsauber). Weiterspielen kommt also mit **N1** (Klick und Ansagen nativ); Android verlangt dafür einen Vordergrund-Dienst mit sichtbarer Benachrichtigung („StageBoard spielt“). Bis dahin bleibt das heutige Verhalten.

### 8g. Offen

- Läuft die Uhr-Synchronisation bei gesperrtem Bildschirm weiter (nativ), oder reicht der letzte Stand (Drift ~0,3 ms pro Minute)?
- Aufwand N1 grob: Plan-Format und Brücke, Mischer mit Klick-Synthese und Clip-Wiedergabe, Wechsel Web Audio ↔ nativ, Tests – geschätzt 1–2 Wochen; N2 deutlich mehr.

### 8h. Entschieden: eine Engine, eine Sprache, ein Format (Marco, 2026-11-10)

Anlass: Marcos Konzept „Cross-Platform Core Audio Engine“ (getrennter Audio-Faden, lock-free Ringpuffer, Float, Limiter, berechneter Klick, Ansagen als PCM) – abgeglichen mit docs/29 und diesem Dokument; am selben Tag der Fehler aus §8i.

| Frage | Entscheidung |
|---|---|
| Sprache | **C++**, Ausgabe über **miniaudio** auf Laptop/Browser/iOS, auf Android weiter eigenes AAudio (mehr Kontrolle über schwierige Geräte). Rust verworfen: zweite Toolchain, vorhandener C++-Code (`native_output.cpp`) und Signalsmith (Zeitdehnung) sind C++ |
| Ein Kern überall | **derselbe C++-Kern als WASM** im AudioWorklet (Browser, WebView-Notbetrieb #708) – damit entfällt „zwei Engines, die sich gleich verhalten müssen“ (§8c). Als **Stufe 2**, nach dem Kern als Bibliothek, gemessen gegen heute |
| Track-Format | **nur Opus**, 48 kHz, Stereo, **160 kbit/s** – für Tracks und Stems. Erst erwogen: FLAC bzw. wählbar je Gerät; verworfen, weil ein **Android-Host** (docs/25) beide Fassungen speichern und erzeugen müsste (50 Songs: ~250 MB statt ~1,1 GB). Startposition genau: die Füll-Lücke steht im Opus-Kopf (bei MP3/AAC behandeln Decoder sie verschieden – bis 25–50 ms zwischen Geräten) |
| Wer wandelt um | das **hochladende Gerät**, mit **libopus als WASM** (nicht WebCodecs – nicht überall verfügbar); die vorhandene Bibliothek einmal. Originale optional nur als Archiv auf dem Laptop-Server, nie auf die Tablets |
| Dekodieren | eigener Decoder (libopus) in Engine und WASM – unabhängig von Codecs des Geräts oder Browsers |

**Übernommen aus dem Konzept:** Audio-Faden ohne Speicher anlegen, Sperren und Speicherbereinigung; Austausch nur über lock-free Ringpuffer; Dekodieren in einem eigenen Faden; durchgehend Float; Pegel je Quelle; **Limiter** am Ende; Klick berechnet; Ansagen als PCM (heute schon Piper).

**Bewusst anders als im Konzept:**
- **Kein Sample-Zähler als einzige Uhr:** je Gerät ja, aber laufend auf die **Band-Zeit** abgebildet (docs/29) – Audio-Quarze laufen auseinander (Fire +256 ppm ≈ 15 ms/min).
- **Keine eigene Tempo-Karte:** die Engine bekommt die Schlagzeiten aus dem starren Raster (docs/14 §5a).
- **Kein Loopback-Rundlauf:** gebraucht wird die *Ausgabe*-Latenz, gemessen per Mikrofon (§4); ein halber Rundlauf ist sie nicht. **Keine Aufnahme-Kompensation** – StageBoard nimmt nicht auf.
- **Dazu, was dem Konzept fehlte:** Zeitdehnung (Signalsmith), Teil-Sprünge mit Überblendung, Stems stumm/solo, mehrere Ausgänge mit „nie ein falsches Signal ans Publikum, sicherer Stopp“ (docs/28), **Selbstüberwachung** (unplausible Werte melden, §8i) und **Dauertest ≥ 24 h** bei jeder größeren Änderung.

**Stufen:**
1. **Kern als C++-Bibliothek ohne Ausgabe:** Transport in Band-Zeit, Ereignisplan, Klick, Clip-Player, Mischer, Limiter, Opus-Decoder, Resampler (für Ausgänge mit 44,1 kHz). Getestet offline: in einen Puffer rechnen, gegen bekannte Werte prüfen.
   *Stand 2026-11-10 (`native/engine/`):* Uhr-Abbildung Ausgabe-Frame ↔ Band-Zeit (Drift = robuste Steigung über ~1 min, Lage = mittleres Mittel der letzten 32 Abweichungen, weich eingeglitten; Sprung erst nach drei Beobachtungen in Folge > 20 ms in dieselbe Richtung, gezählt; einzelne Ausreißer werden übergangen. Vorher lernte sie die Drift aus jeder Beobachtung einzeln – bei ±3 ms Rauschen lief sie bis an ±1000 ppm, gemessen über 20 Läufe: neu ±19 ppm, Lage höchstens 1,6 statt 3,7 ms daneben), Transport wie `playbackTransport.ts` (Rate, Sprung), Klick wie `clickEngine.ts` auf den Bruchteil eines Samples genau, Pegel je Quelle + Master (5 ms gleitend), Limiter −1 dBFS, Übergabe nur über lock-free Warteschlangen. Clip-Player für Track/Stems/Ansagen (je Spur eigener Bus: Klick, Track, Stem, Ansage): liest genau dort, wo der Song gerade ist, folgt der Drift durch minimal schnelleres/langsameres Lesen (±0,5 %), blendet bei Sprung/Pause/Fortsetzen über 5 ms. Tests in CI mit Sanitizern; u. a. Fire-Drift 256 ppm über 10 min ohne Sprung, Fehler < 0,5 ms; Track bei Drift + ±0,5 ms Uhr-Rauschen höchstens 0,4 ms daneben; Track ohne Drift Sample für Sample exakt; Ausgabe unabhängig von der Blockgröße. Opus-Decoder (`OpusClip`, libopus 1.5.2 fest im Repo unter `native/engine/third_party/opus`, Marco 2026-11-10): eigener Ogg-Leser prüft jede Seite (Prüfsumme, eine Spur, vollständig bis zur letzten Seite) – eine beschädigte oder abgebrochene Datei spielt nicht; Bild 0 = erstes Sample des Songs (Füll-Lücke aus dem Opus-Kopf weg, Ende auf die letzte Zeitangabe gekürzt), Pegel aus dem Kopf; Lesen und Springen ohne Speicher anlegen, also im Dekodier-Faden nutzbar. Geprüft gegen Dateien von ffmpeg (fremder Encoder und Muxer): Länge auf das Sample genau, Versatz 0, gegen das Ursignal 36–40 dB; ffmpegs eigener Decoder (andere Umsetzung) weicht nur um −135 dB ab (Rundung). Vorlauf beim Springen gemessen: die 80 ms aus RFC 7845 lassen die ersten 10 ms noch −18 dB neben dem durchgehenden Dekodieren (CELT sagt über Pakete voraus), 160 ms −44 dB, **240 ms −67 dB** (gewählt), 320 ms −90 dB – für Stufe 4: ein Sprung kostet je Spur 240 ms Dekodieren (Fire mit 6 Spuren ~20 ms je Spur), der Dekodier-Faden muss ihn also vor dem Sprungzeitpunkt vorbereiten. Resampler im Clip-Player (`sinc.h`, Kaiser-gefensterter Sinc): liest jede Quelle an beliebiger Stelle, also Umrechnung 48 → 44,1 kHz, Ansagen mit 22,05 kHz und das Nachführen der Drift in einem Schritt, ohne eigenen Puffer und ohne Verzögerung; die lineare Interpolation davor nahm zwischen zwei Samples bis zu 2 dB bei 10 kHz weg. Gemessen gegen den direkt zur Ausgabezeit berechneten Ton: 48 → 44,1 kHz bis 18 kHz ≥ 98 dB, 20 kHz 72 dB (64 Taps; 32 Taps hätten bei 20 kHz nur 23 dB); gleiche Rate zwischen den Samples bis 16 kHz ≥ 92 dB (32 Taps), Ansage 22,05 → 48 kHz ≥ 93 dB; auf der eigenen Rate weiter Sample für Sample exakt. Über 22,05 kHz wird bei 44,1 kHz nur gedämpft (23 kHz −21 dB) – es spiegelt sich auf über 20 kHz, unhörbar, und Opus überträgt nichts über 20 kHz; eine tiefere Grenze hätte 20 kHz selbst gekostet. Last (Laptop, -O2) für 6 Stereo-Spuren + Klick: 0,75 % eines Kerns bei 48 kHz, 1,27 % bei 44,1 kHz (lineare Interpolation vorher 0,15 %) – auf dem Fire in Stufe 3 messen. Nebenbei gefunden: der Limiter blieb nach der ersten Begrenzung für immer bei 0,99993 stehen (Float-Auflösung nahe 1), jetzt in double. **Stufe 1 damit vollständig.** Tempo ≠ 1 ändert vorerst die Tonhöhe (Zeitdehnung mit Stufe 4).
   *Warum das auch für den gesperrten Bildschirm zählt:* der heutige Klick plant per JS-Timer nur 150 ms voraus; gesperrt drosselt Chromium Timer bis auf einmal pro Minute (Fire, 2026-11-10, trotz Vordergrund-Dienst #724). Die Engine plant im Audio-Faden selbst.
2. **Derselbe Kern als WASM** im Browser/in der WebView, ersetzt die heutige Klick-Engine – gemessen gegen heute.
3. **Android:** der Kern im AAudio-Callback statt der Pipe, mit Vordergrund-Dienst (= N1, §8f).
4. **Tracks:** Umwandlung nach Opus beim Hochladen, nativ dekodieren, dann Stems, Zeitdehnung, Sprünge (= N2).
   *Stand 2026-11-10 (Kern, offline getestet):* `StreamedClip` (`native/engine`, stream_clip.h) spielt eine Opus-Datei, ohne sie ganz zu dekodieren: komprimiert im Speicher (~6 MB je 5 min bei 160 kbit/s), dekodiert nur je zwei Fenster von 2,7 s – eins folgt der Abspielstelle, eins wird für das nächste Ziel vorab gefüllt (Sprungziel, Startpunkt von Play), am Sprung überblendet der Clip-Player von einem ins andere. Statt 115 MB je Stereo-Spur für den ganzen Song ~2 MB. Dekodiert wird im Steuer-Faden (`Engine::pump`, je Aufruf höchstens 100 ms Audio je Fenster – auf Android ein eigener Faden), der Audio-Faden liest nur; ein Block, unter dem sich ein Fenster bewegt hat, wird verworfen, nie gespielt. Fehlen Daten (unangekündigter Sprung, Dekoder hinkt mehr als 1 s hinterher), ist die Spur still und blendet weich ein – das Leerlaufen selbst bricht hart ab (nichts zum Ausblenden da) und wird gezählt (`missingReads`, §8i). Gegen dieselbe Datei im Speicher, mit absichtlich kleinem Fenster (85 ms): Durchspielen bit-genau gleich, angekündigter Sprung zurück bit-genau, nach vorn 85 dB unter dem Signal (nur der Opus-Vorlauf), unangekündigter Sprung 5,7 ms Lücke, dann 97 dB, mit echtem Dekodier-Faden bit-genau. Last (Laptop, 6 Stereo-Spuren + Mischen): im Speicher 0,79 %, gestreamt mit Dekodieren 0,92 % eines Kerns (44,1 kHz: 1,31 / 1,47 %). Dabei gefunden und behoben: ein Sprung genau auf einem Blockende stapelte die übersprungenen Klicks (#726). Offen: in die native Ausgabe (Dekodier-Faden, Tracks aus der App laden), Umwandlung nach Opus beim Hochladen, Zeitdehnung.
5. **Mehrere Ausgänge** nach der Bühnenkarte (= N3).

**Erste Aufgabe:** auf dem **Fire** (schwächstes Gerät) messen, ob **6 Opus-Spuren gleichzeitig** (Track + Stems) mit Reserve dekodiert werden – vor der Festlegung von Stufe 4.

### 8i. Fehler 2026-11-10: 32-Bit-Frame-Position nach 12,4 h

Der Fire (Android 9, AAudio über den alten AudioTrack-Weg) meldet die Frame-Position nur 32 Bit breit; nach 2³¹ Frames (12,4 h bei 48 kHz) lief sie über, die Ausgabe rechnete mit 2³² Frames Versatz (Latenz **89.478.694 ms**) und spielte nichts mehr. Sichtbar geworden, weil ein Vordergrund-Dienst die App über Nacht wach hielt. Behoben in #722 (Abstand modulo 2³²). Lehre für die Engine: jeden Wert vom Betriebssystem auf Plausibilität prüfen und melden, Dauertest ≥ 24 h.
