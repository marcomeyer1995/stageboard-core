# Clock-Sync- und Cue-Präzision: Untersuchung vom 2026-09-02

Diese Datei dokumentiert eine mehrstündige Live-Debugging-Session zu #31 (NTP-Style Clock Sync),
ausgelöst durch Marcos Beobachtung, dass der Sync-Status auf Tablet/Handy im heimischen WLAN
dauerhaft orange war. Ziel: falls das Thema erneut aufkommt (neue Hardware, neues Netzwerk,
"warum ist der Sync-Status wieder komisch"), hier zuerst nachschlagen statt bei Null anzufangen.

**Kurzfassung:** Die Sync-Genauigkeit selbst wurde in zwei Runden verbessert (#80, #82) und ist
inzwischen im einstelligen bis niedrigen zweistelligen ms-Bereich - bestätigt sowohl per
kabelgebundenem Ground-Truth-Check als auch per End-to-End-MIDI-Feuerungstest. Die zusätzlich
beobachteten größeren Abweichungen (60-90ms) beim visuellen Foto-Vergleich sind **kein
Sync-Problem**, sondern Chrome/Android-Rendering-Verhalten (Bildschirm-Sleep/Resume-Nachholbedarf)
- und für die tatsächliche Cue-Feuerung (Audio/MIDI) ohnehin irrelevant, weil die am DOM-Rendering
komplett vorbeigeht.

## 1. Ausgangslage

Marcos Beobachtung: auf `localhost` (Laptop selbst) zeigte der Sync-Status Offset ~0ms und Jitter
~20ms (grün), auf extern verbundenen Geräten (Tablet, Handy) dagegen durchgehend orange mit hohem
Offset/Jitter. Frage: Root Cause finden, verbessern falls sinnvoll, und einschätzen ob es am
privaten Heimnetz (kein dedizierter Stage-Router) liegt.

## 2. Runde 1 - Jitter ist das falsche Signal (#80)

**Problem:** `SystemHealthWidget.tsx`s Status-Ampel hing an `jitterMs` - der Spanne zwischen
schnellster und langsamster Sample-RTT *innerhalb eines einzelnen Bursts* von 7 `GET /time`-Requests.
Diese Zahl reagiert auf **jeden einzelnen langsamen Paket-Ausreißer** in diesem einen Burst, auch
wenn der tatsächlich verwendete Offset (aus dem Sample mit der niedrigsten RTT) davon unbeeinflusst
bleibt.

**Live-Beweis** (Debug-Logger, siehe Abschnitt 5.1): Auf zwei realen Geräten schwankte `jitterMs`
burst-zu-burst zwischen 30ms und 638ms (!), während der tatsächlich verwendete Offset sich nur um
1-4ms bewegte. Der Status-Punkt war also fast permanent orange, obwohl die Zeit korrekt
synchronisiert war.

**Fix:** `clockSync.ts` führt jetzt ein rollierendes Fenster der letzten 5 Burst-Offsets
(`OFFSET_HISTORY_SIZE`) und berechnet daraus `driftMs` (Spanne *zwischen* Syncs, nicht *innerhalb*
eines Bursts). Die Status-Ampel in `SystemHealthWidget.tsx` hängt jetzt an `driftMs`
(Schwelle 15ms), nicht mehr an `jitterMs`. `jitterMs` bleibt als reines Diagnose-Feld erhalten.

- PR: #80 (gemerged)
- Quelldateien: `packages/stage-pwa/src/lib/clockSync.ts`, `packages/stage-pwa/src/store/useClockSyncStore.ts`, `packages/stage-pwa/src/widgets/SystemHealthWidget.tsx`

## 3. Runde 2 - Systematisch asymmetrische Pfade (#82)

Selbst nach Runde 1 zeigte ein Tablet einen stabilen, aber nicht korrekten Offset (~51-90ms,
je nach Burst) - `driftMs` war unauffällig (das Tablet war sich burst-zu-burst *selbst* einig),
aber ein per USB/adb durchgeführter, WLAN-unabhängiger Ground-Truth-Check (Abschnitt 5.2) zeigte
den wahren Offset bei ~41-43ms.

**Ursache:** Die Standard-NTP-Mittelpunkt-Schätzung (`offset = serverTime - (t0+t1)/2`) setzt
symmetrische Latenz in beide Richtungen voraus. Bei einem **systematisch asymmetrischen** WLAN-Pfad
(eine Richtung durchgehend langsamer als die andere - ein WLAN-Funkverhalten, keine Stauung) trägt
der Fehlerterm `(outbound_delay - inbound_delay) / 2` linear mit der RTT - bestätigt live: die
(RTT, Offset)-Paare eines Bursts fitteten eine fast perfekte Gerade (R² > 0.99, Steigung ~0.50) über
zwei unabhängige Bursts im Abstand einer Minute.

**Fix:** `clockSync.ts`s `estimateOffset()` legt jetzt zusätzlich eine lineare Regression durch die
(RTT, Offset)-Paare eines Bursts und extrapoliert auf RTT=0 - das kürzt den Asymmetrie-Term direkt
heraus. Nur aktiv wenn echte Evidenz für einen linearen Trend vorliegt (≥3 Samples, ≥10ms
RTT-Spannweite, R² ≥ 0.5), sonst Fallback auf die alte Min-RTT-Auswahl - ein sauberer, rauscharmer
Burst würde durch eine Gerade durch reines Rauschen nur schlechter, nicht besser.

- PR: #82 (gemerged)
- Quelldatei: `packages/stage-pwa/src/lib/clockSync.ts` (`fitLine`, `estimateOffset`)

## 4. Sync-Check-Widget (#81)

Ein neues Dashboard-Widget (`type: 'sync-check'`, `SyncCheckWidget.tsx`) für den visuellen Vergleich:
die ganze Kachel invertiert die Farbe bei jeder vollen Sekunde der **synchronisierten** Uhr
(`getServerTime()`, nicht die lokale Gerätezeit) - zwei Geräte nebeneinander sollten im Takt
blinken. Zeigt zusätzlich Offset/Drift zur Einordnung.

- PR: #81 (gemerged)
- Quelldateien: `packages/stage-pwa/src/widgets/SyncCheckWidget.tsx`, registriert in `registry.tsx`

**Bekannte Falle:** Wenn ein Dashboard-Layout bereits einen `sync-check`-Widget-Eintrag enthält,
aber der gerade live ausgelieferte Build diesen Typ (noch) nicht kennt, rendert
`Dashboard.tsx:262` (`if (!definition) return <div key={widget.i} />`) einen leeren Platzhalter
ohne Fehler - "nur der Rahmen ist sichtbar" ist das Symptom für **falsche/veraltete Build-Version
live**, nicht für einen App-Bug. Passiert typischerweise, wenn zwischen zwei Live-Rebuilds ein
anderer, nicht zusammengeführter Branch deployed wurde. Abhilfe: sicherstellen, dass der live
gebaute Branch den Widget-Code tatsächlich enthält (ggf. `main` in den Feature-Branch mergen und neu
bauen), nicht am Widget-Code selbst suchen.

## 5. Methodik für künftige Live-Diagnosen dieser Art

### 5.1 Temporärer Debug-Logger (Muster: `clockSyncDebug.ts`)

Für Sample-genaue Live-Daten: ein `localStorage`-Flag-gesteuerter Logger (`sb:debug:clocksync`),
siehe `packages/stage-pwa/src/lib/clockSyncDebug.ts` (gleiches Muster wie `gridDebug.ts`, siehe
docs/03 §1a). Aktivieren, Seite neu laden, Log per CDP/adb live mitschneiden
(`scripts/tablet-debug.mjs watch`). **Wichtig:** Chrome liefert bei manchen CDP-Setups das erste
`console.log` nach Seitenaufruf ohne aufgelöste Objekt-Properties (nur `"Object"`) - erst ab dem
zweiten Log-Aufruf sind die Felder sichtbar. Bei kritischen ersten Werten notfalls einen zweiten
Burst abwarten.

### 5.2 WLAN-unabhängiger Ground-Truth-Check über USB/adb

Um zu prüfen, ob ein gemessener Offset *wirklich* stimmt (unabhängig vom WLAN-Pfad, der ja gerade
der Verdächtige ist): über die ohnehin für `adb forward` genutzte USB-Verbindung eine eigene
NTP-artige Burst-Messung direkt gegen `Date.now()` des Geräts fahren (per `Runtime.evaluate` via
CDP-WebSocket, siehe damaliges Ad-hoc-Skript). USB/adb-Tunnel sind typischerweise viel symmetrischer
als WLAN (bestätigt: RTT-Offset-Korrelation nahe 0 über USB, vs. ~0.50 Steigung auf dem betroffenen
WLAN-Pfad) - eine saubere zweite Referenz, ohne zusätzliche Hardware.

### 5.3 Rendering-Latenz vs. Sync-Genauigkeit auseinanderhalten

Ein Foto-Vergleich mehrerer Geräte-Bildschirme (auch bei sehr kurzer Verschlusszeit, z.B. 1/700s)
misst **wann ein Wert auf dem Bildschirm sichtbar wurde**, nicht wann er berechnet wurde. Diese
beiden können auseinanderfallen:

- **`PerformanceObserver({type: 'long-animation-frame'})`** (Long Animation Frames API, in Chrome
  verfügbar) zeigt einzelne Frames, die ungewöhnlich lange brauchten, inkl. `blockingDuration` und
  (bei `buffered: false`) Script-Attribution (`entry.scripts[].sourceURL`/`invoker`). Sehr nützlich
  um zwischen "die App blockiert den Hauptthread" und "der Browser/Compositor braucht länger" zu
  unterscheiden.
- **Bestätigter Fund:** Wird ein Tab per `visibilitychange` "hidden" (Bildschirm sperrt/schläft) und
  später wieder "visible", braucht Chrome auf dem betroffenen Tablet real gemessen **~1.2 Sekunden**
  bis wieder normale Frame-Zeiten anliegen (3 aufeinanderfolgende Frames mit 194-275ms Dauer direkt
  beim Aufwachen). Das ist Chrome/Android-Verhalten (Compositor-Suspend bei verstecktem Tab), kein
  App-Bug.
- **Wichtige Einschränkung:** Der Screen Wake Lock (`useWakeLock.ts`) verhindert nur den
  *automatischen Timeout*. Laut eigenem Doc-Kommentar der Datei gibt die Plattform den Lock sofort
  frei, sobald die Seite "hidden" wird (manuelles Sperren per Power-Button, App-Wechsel) - das
  Sleep/Resume-Verhalten oben kann also trotz aktivem Wake Lock auftreten, wenn der Bildschirm
  manuell gesperrt wurde.
- **Verworfen:** Kamera-Belichtungsartefakt (durch 1/700s-Verschlusszeit ausgeschlossen) und
  "Cold-Start nach Reload" (durch Marcos Hinweis ausgeschlossen: Geräte liefen bereits 2h ohne
  Reload, Status durchgehend grün) - beide Theorien wurden live geprüft und verworfen, siehe
  Gesprächsverlauf für Details, falls diese Fragen erneut aufkommen.
- **Für die Praxis nicht relevant:** Web Audio (`audioContext.currentTime`) und WebMIDI-Scheduling
  laufen nie über das DOM/den Compositor - eine Rendering-Verzögerung auf einem Tablet-Bildschirm
  betrifft nur das, was auf *diesem Bildschirm sichtbar* ist (z.B. Prompter-Scroll), nicht die
  tatsächliche Cue-Feuerung auf irgendeinem Gerät.

### 5.4 End-to-End-Test der tatsächlichen Cue-Feuerungspräzision

Ohne echte MIDI-Hardware lässt sich die reale Feuerungsgenauigkeit trotzdem end-to-end prüfen:

1. Virtueller MIDI-Port auf dem Server-Rechner via `easymidi` (RtMidi-Bindings, userspace, kein
   Root/Kernelmodul nötig): `new easymidi.Input('<Name>', true)` - erscheint sofort als echter
   ALSA-Sequencer-Port, den auch Chromes WebMIDI-Implementierung sieht.
2. **Mixed-Content-Falle:** Ein Test-Empfänger-Server für die Rückmeldung der Geräte muss über
   HTTPS laufen (selbes Dev-Zertifikat wie der Stage-Server, `certs/dev-cert.pem`/`dev-key.pem`
   wiederverwenden) - eine `https://`-Seite blockiert `fetch()` zu `http://` lautlos
   ("Failed to fetch" ohne aussagekräftige Fehlermeldung), auch von Chrome auf demselben Rechner.
3. Jedes Gerät führt unabhängig einen eigenen Mini-NTP-Burst gegen `/time` und wartet dann (per
   `setTimeout`, in den letzten ~15ms per `requestAnimationFrame` verfeinert) bis
   `getServerTime() >= gemeinsames_Ziel-Epoch-ms` - exakt das Scheduling-Muster, das echtes
   Ahead-of-Time-Dispatch (docs/00 §4) nutzen würde.
4. **CDP-Falle:** `Runtime.evaluate` mit `awaitPromise: true` scheint abzubrechen, wenn die
   DevTools-WebSocket-Verbindung vor Promise-Auflösung geschlossen wird (z.B. durch ein
   Tool-eigenes Timeout) - bei einer Wartezeit von mehreren Sekunden/einer Minute daher immer
   "fire-and-forget" injizieren (die async-Funktion sofort im Hintergrund starten, `Runtime.evaluate`
   selbst synchron mit einem Platzhalter zurückkehren lassen), nicht auf die Promise-Auflösung der
   eigenen Injektion warten.

**Ergebnis dieses Tests (2026-09-02):** Telefon, Tablet und Laptop-Chrome feuerten alle innerhalb
von 0-7.5ms des gemeinsamen Ziel-Zeitpunkts (gemessen an der jeweils eigenen `getServerTime()`);
das echte MIDI-Signal kam 10ms nach Ziel beim virtuellen Empfänger an. Bestätigt: die
Sync-Genauigkeit für tatsächliche Cue-Feuerung ist weit besser als die visuell beobachteten
60-90ms-Lücken vermuten ließen.

## 6. Netzwerk-Infrastruktur-Erkenntnis (kein App-Bug)

Bei der Untersuchung eines separaten `ERR_ADDRESS_UNREACHABLE`-Fehlers auf einem zweiten Handy:
per USB/adb bestätigt (`ip neigh show` zeigte den Server-Eintrag als `FAILED`, `ping` lieferte
"Destination Host Unreachable" vom Handy selbst) - eine lokale ARP-Auflösung zwischen zwei
WLAN-Clients (Handy und Server-Laptop) im selben Eero-Mesh-Netzwerk schlägt intermittierend fehl,
vermutlich durch Mesh-Node-Roaming/Bridging-Aussetzer unter Last (5 gleichzeitig verbundene Geräte).
Kein App-/Server-Bug, keine Verbindungs-Obergrenze im Code. Bestätigt Marcos ursprüngliche Vermutung
("kein dedizierter Stage-Router") mit einem konkreten Mechanismus statt nur einer Ahnung.

**Praktische Abhilfe, falls es live wieder auftritt:** Server-Laptop nach Möglichkeit per Ethernet
ans Mesh anbinden (entfernt eine ganze WLAN-Hop-Abhängigkeit für die Erreichbarkeit des Servers);
für einen echten Gig ist ein einzelner dedizierter Access Point ohne Mesh-Roaming kategorisch
stabiler als Consumer-Mesh-Hardware.

## 7. Fotos dieser Session

`docs/media/clock-sync-5device-photo{1,2,3}.jpg` - fünf Geräte (2 Laptops, 2 Tablets, 1 Handy)
gleichzeitig mit dem Sync-Check-Widget, aufgenommen mit 1/700s Verschlusszeit nach ~2h
durchgehendem Betrieb ohne Reload. Zeigen die (durch Rendering-Latenz, nicht Sync-Fehler erklärten)
Abweichungen von Abschnitt 5.3.
