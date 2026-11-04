# Audio-Ausgabe für alle Geräte: Wege, Zeitstempel, Ausgleich

Konzept, Stand 2026-11-05, kein Beschluss im Detail. Anlass: Marco hat Klick und Track auf allen Tablets gleichzeitig gehört (#695) – Redmi, Laptop und Handy klingen zusammen, der Fire liegt hörbar daneben. Gemessen mit dem Laptop-Mikrofon: der Fire ist **360 ms** nach dem Redmi zu hören, seine eigenen Zeitstempel sagen nur ~180 ms (docs/29 §11). Baut auf docs/28 (getrennte Ausgänge, eigener USB-Treiber) und docs/29 (eine Zeitbasis) auf.

## 1. Entscheidungen (Marco, 2026-11-05)

- **Für alle Geräte am Markt, nicht für die Geräte im Haus.** Kein Weg, der nur auf dem Fire oder nur auf MediaTek passt; eine große Gemeinschaft soll ihre eigenen Tablets und Handys benutzen können.
- **Beide nativen Wege anbieten:** Androids eigener Treiber (AAudio) und unser eigener USB-Treiber (docs/28 §4). Der Browser-Weg (Web Audio) bleibt für alles andere.
- **Ausgleich immer möglich, am besten nie nötig:** jeder Weg kann um eine gemessene Verzögerung früher spielen; Ziel ist ein Weg, dessen Zeitangabe stimmt, sodass nichts eingemessen werden muss.

## 2. Was wir wissen

| Gerät · Weg | Puffer bis hörbar | stimmt die Zeitangabe? | Quelle |
|---|---|---|---|
| Fire HD (Android 9) · WebView | ~240 ms laut Zeitstempel, **~420 ms gehört** | nein: ~180 ms zu wenig, dazu Ausreißer (bis 13 s, −17…−32 ms) und Spitzen bei Stop | docs/29 §11 |
| Fire · AAudio (fester Ausgang) | ~114 ms | nicht gemessen | docs/28 §2 |
| Redmi Pad SE · WebView, Lautsprecher | ~35–60 ms | ja (bis auf jedes zehnte Paar +5 ms) | docs/29 §11 |
| Redmi · USB über Androids Treiber | – | stumm, meldet „läuft“ (MediaTek-HAL) | docs/28 §3 |
| Redmi · eigener USB-Treiber | Rundlauf 3 ms | ja (wir zählen die Samples selbst) | docs/28 §5 |
| Laptop · Chrome | ~48 ms | ja (±2 ms) | docs/29 §11 |

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

Damit es auf jedem Gerät funktioniert, ohne dass wir es vorher kennen:

1. **Selbsttest beim ersten Einrichten** eines Ausgangs (und wenn sich der Weg ändert – Kopfhörer, Bluetooth, Interface): ein kurzer Klick-Zug, aufgenommen von einem Mikrofon. Ergebnis: die wirkliche Verzögerung bis hörbar gegen das, was der Weg behauptet.
   - **Mikrofon im selben Gerät** für Lautsprecher-Wege (jedes Tablet hat eins; die Eingangslatenz wird mit einem zweiten, bekannten Klick herausgerechnet – oder mit dem Rig-Check-Verfahren über ein zweites Gerät).
   - **Ein Gerät hört alle** (Rig-Check-Messrunde, docs/24): ein Handy oder Laptop nimmt nacheinander jeden Ausgang der Band auf – so wie heute Nacht mit dem Laptop-Mikrofon.
   - **Loopback** für Interfaces: Ausgang in einen Eingang desselben Interfaces (docs/28 §5), Mikrofon unnötig.
2. **Urteil je Weg:** stimmt die Zeitangabe (Abweichung ≤ 2 ms), braucht der Weg keinen Ausgleich. Weicht sie fest ab, wird der Unterschied als Ausgleich gespeichert. Schwankt sie von Start zu Start (Fire-WebView: bis 30 ms je App-Start), sagt die App das offen und empfiehlt einen anderen Weg.
3. **Gemeinschaft:** die Ergebnisse (Modell, Android-Version, Weg, behauptet vs. gehört, Schwankung) können anonym geteilt werden – eine Tabelle, welches Gerät auf welchem Weg taugt. Neue Musiker bekommen einen Startwert, bevor sie selbst messen. (Freiwillig; Datenschutz und Server dafür offen, docs/16.)

## 5. Ausgleich

Wie heute (#491, docs/21 §9): ein Weg spielt um seinen gemessenen Rest früher. Neu ist, wofür er steht: **nur den Unterschied zwischen Zeitangabe und Gehörtem** – bei einem Weg mit stimmender Zeitangabe ist er 0, und die Pufferlänge selbst muss niemand mehr einmessen, weil die Zeitangabe sie enthält. Bei Funkstrecken (In-Ear-Sender, Bluetooth) und Mischpulten bleibt ein Rest, den nur eine Messung kennt – dafür bleibt die Möglichkeit immer da.

## 6. Reihenfolge

1. **AAudio-Spike (Oboe) als Ausgabeweg für den Klick** – auf allen Geräten im Haus (Fire, Redmi, Xiaomi-Handy), nicht nur dem Fire: Klick nativ, geplant auf der Band-Zeit, Zeitangabe über `getTimestamp`. Gemessen mit dem Laptop-Mikrofon wie heute: behauptet vs. gehört, Schwankung je Start, Abstand zu den anderen Geräten. Erst wenn das auf allen dreien hält, weiter.
2. **Engine nativ:** Track und Stems (PCM über die Brücke oder nativ dekodiert), Drift-Anpassung, Stummschalten; Web Audio bleibt als Weg erhalten.
3. **Eigener USB-Treiber als zweiter nativer Weg** in dieselbe Engine (docs/28 §6, Eingang zuerst stabil).
4. **Geräteprüfung** (§4) mit Mikrofon und Loopback, Urteil je Weg, Ausgleich nur wo nötig; Anzeige in Bühnentechnik.
5. **Gemeinschafts-Tabelle** (§4.3), wenn es Nutzer außerhalb gibt.
6. Später: iOS (AVAudioEngine mit `outputLatency`/Host-Zeit – derselbe Gedanke), Windows/macOS für den Laptop-Host (docs/25).

## 7. Offen

- Oboe als Fremdbibliothek (Apache 2.0) oder AAudio direkt? Oboe bringt Rückfall auf OpenSL ES für Android < 8.1 und viele Geräte-Umgehungen – Vorschlag: Oboe.
- Track-Daten in die native Engine: dekodiert über die Brücke (einfach, Speicher) oder nativ dekodieren (MediaCodec)?
- Wie geht die Geräteprüfung mit dem eingebauten Mikrofon, wenn der Lautsprecher daneben liegt (Übersteuerung, Echo-Unterdrückung des Systems abschalten)?
- Was zeigt die App, wenn kein Weg auf einem Gerät stimmt (der Fire-WebView-Fall)? Vorschlag: rotes „Ausgang ungenau“ in Bühnentechnik mit der gemessenen Schwankung, Empfehlung eines anderen Wegs.
