# Stage-Server-Status "Lade…" und Audio-Downloads: Untersuchung vom 2026-09-18

Diese Datei dokumentiert die Live-Untersuchung zu Marcos Beobachtung, dass die Einstellungen
("Aktive Band (Hardware)") nach einem Band-Wechsel über 30 Sekunden auf "Lade…" standen, obwohl der
Stage-Server dieselben Anfragen in wenigen Millisekunden beantwortet. Ausgangspunkt war der Bau des
Band-Wechsel-Wizards (#236, #238-#240). Ziel: falls das Symptom (langsame, aber nicht fehlgeschlagene
Anfragen während eines Audio-Syncs) wieder auftaucht, hier zuerst nachschlagen. **Ein Teil des
Problems ist bewusst offen geblieben - siehe Abschnitt 5.**

**Kurzfassung:** Ursache waren mehrere gleichzeitige `/audio/...`-Downloads direkt nach einem
Band-Wechsel, die die WLAN-Strecke und die eine geteilte HTTP/2-Verbindung sättigten; kleine Antworten
(Status, Sync) reihten sich dahinter ein. Behoben bzw. abgeschwächt (#240): Downloads laufen jetzt
nacheinander, der Status zeigt sofort den letzten bekannten Stand, und "langsam" wird nicht mehr als
"nicht erreichbar" gemeldet. **Offen:** während ein einzelner Track streamt, brauchen kleine Antworten
weiterhin ca. 1,2 s (vorher 9-15 s).

## 1. Ausgangslage

Einstellungen-Tab: "Lade…" für mindestens 30 Sekunden. Messung des Servers von außen (curl) und im
eigenen Fastify-Log: `/server/active-workspace` 3 ms, `/server-info` 3 ms, `/workspaces` 7-10 ms.
Der Server ist also nicht das Problem - jedenfalls nicht im Leerlauf.

## 2. Was ausgeschlossen wurde (und wie)

* **Server rechnet langsam:** 300 curl-Anfragen im Abstand von 100 ms gegen den idle Server: Median
  4 ms, Maximum 6 ms, keine CPU-Last (`ps`).
* **HTTP/1.1-Verbindungslimit (6 pro Origin):** im Fastify-Log stammen 429 Anfragen des Tablets von
  nur 4 Quellports; die drei Status-Anfragen kommen im selben Moment über denselben Port (`remotePort`).
  Das ist HTTP/2-Multiplexing (siehe #129).
* **Service Worker:** existiert nicht (`vite.config.ts` ohne Workbox, kein `sw.js` in `dist/`).
* **Beschäftigtes Tablet:** im Diagnose-Log (Abschnitt 4) `long tasks: none`, `js-continuation` 2-7 ms,
  Event-Loop-Lag 7-12 ms - die App reagiert sofort, sobald Daten da sind.

## 3. Die Ursache

Diagnose-Log des Tablets im langsamen Fall: `server 9174ms` (Zeit bis zum ersten Byte),
`blocked 5896ms` beim zweiten Durchlauf, Gesamtdauer 10,9 s bzw. 14,9 s.

Korrelation mit dem Server-Log (Serverzeit, siehe Abschnitt 4 zur Uhr-Verschiebung): Direkt nach dem
Band-Wechsel (`activate-hardware` um 20:12:58) startete das Gerät den Audio-Sync für die neue Band und
löste **drei `/audio/...`-Downloads gleichzeitig** aus (Dauer 26-28 s). Genau in diesem Fenster
brauchte der Server *serverseitig* 3,5 s bzw. 1,2 s für `/server-info` (im Leerlauf ~1 ms). Nach dem
Ende der Downloads (ca. 20:13:27) war alles wieder schnell. Die Status-Anfrage war also Opfer, nicht
Ursache.

Auslöser im Code: `reconcileAudioCache` (`audioStorageManager.ts`) startete alle nicht laufenden
Tracks per `Promise.all` gleichzeitig - der Kommentar dort nannte das Problem bereits ("issuing them
all via one Promise.all gives no real priority to any of them"), begrenzt hatte es niemand.

## 4. Methodik (wiederverwendbar)

### 4.1 On-Device-Diagnose ohne adb (inzwischen wieder entfernt)

Für die Untersuchung gab es kurz einen Diagnose-Schalter in den Einstellungen (Flag
`sb:debug:stageServer`, Muster wie `gridDebug.ts`, docs/03 §1a), der die Status-Anfragen auf dem
Tablet vermaß und den Log auf dem Gerät anzeigte, weil ohne adb keine Konsole zur Verfügung stand. Pro
Anfrage: Gesamtzeit und aus dem Resource-Timing des Browsers `blocked` (Warteschlange/Verbindungsaufbau),
`server` (bis zum ersten Byte), `transfer`, `js-continuation` (wie lange nach vollständigem Empfang der
eigene Code lief - ein beschäftigter Main-Thread zeigt sich hier), dazu Netzwerk-Schätzung
(`navigator.connection`), Event-Loop-Lag (Verzögerung eines `setTimeout(0)`) und Long Tasks
(`PerformanceObserver`, Typ `longtask`).

**Entfernt am 2026-09-18** (Marco: "we remove it completely and add it later again if necessary"):
jeder Musiker sah "Diagnose" in den Einstellungen, was dem Prinzip "Standard-UI idiotensicher, Komplexes
versteckt" widerspricht. Der Code steht unverändert in der Git-History (Squash-Commit von #240,
`c7285a0`): `packages/stage-pwa/src/lib/stageServerDebug.ts` (Flag, Logger, Ringpuffer),
`components/StageServerDiagnostics.tsx` (Schalter + Anzeige) samt Tests und die Instrumentierung in
`lib/useStageServerStatus.ts` (`timed()`, `describeNetwork()`, `startLongTaskProbe()`). Zurückholen z.B.
mit `git show c7285a0:<Pfad>`. **Falls wieder eingebaut, nicht wieder für alle sichtbar:** besprochen
wurden ein Entwicklermodus zum Freischalten (wie bei Android: mehrfach auf die App-Version tippen, nur
lokal am Gerät gespeichert) oder Sichtbarkeit nur für Admins der aktiven Band; eine eigene
"Entwickler"-Rolle wäre für ein paar Timing-Zeilen unverhältnismäßig (serverseitige Speicherung,
Admin-Oberfläche).

### 4.2 Tablet-Log mit dem Server-Log korrelieren

`real-server.log` (Fastify, JSON) enthält pro Anfrage Ankunftszeit und `responseTime`. Entscheidend
ist der Vergleich: *wann kam die Anfrage am Server an, wie lange brauchte der Server, was lief
gleichzeitig* (große `/audio/...`-Requests). Kleine Auswertungs-Skripte (Python, Anfrage-ID von
"incoming request" auf "request completed" abbilden) haben gereicht.

### 4.3 Falle: Uhr-Versatz des Tablets

Die Tablet-Uhr ging ca. 1 Stunde (Zeitzone) plus < 1 s gegenüber dem Server nach. Vor jeder Korrelation
erst den Versatz bestimmen (z.B. Ankunft eines Anfrage-Bursts im Server-Log gegen den `reload start` im
Tablet-Log), sonst sucht man im falschen Zeitfenster.

### 4.4 Weitere nützliche Prüfungen

* Idle-Latenz des Servers: Schleife aus `curl -w '%{time_total}'`, Median/Maximum auswerten.
* HTTP/2 nachweisen: Quellports im Server-Log zählen; parallele Anfragen auf einem Port = Multiplexing.
* Ein Tool-Fehlschluss, der hier passiert ist: ein 8-s-Timeout meldete "nicht erreichbar", obwohl der
  Server gesund und nur überlastet war. Ein *langsamer* Server ist nicht *unerreichbar*.

## 5. Behoben (#240)

* **Ursache abgeschwächt:** `reconcileAudioCache` lädt Hintergrund-Tracks nacheinander statt alle
  gleichzeitig; der gerade spielende Track kommt weiterhin zuerst und für sich. `fetchTrack` wirft nie
  (Fehler = `null`), ein fehlgeschlagener Download stoppt die folgenden also nicht.
* **Symptom:** `useStageServerStatus` zeigt sofort den letzten bekannten Stand (In-Memory-Cache, wird
  bei echtem Ausfall verworfen), übernimmt jede der drei Antworten einzeln statt auf die langsamste zu
  warten, und markiert nach 8 s ohne Antwort `slow` ("Stage-Server antwortet langsam…") statt
  "nicht erreichbar". `unreachable` gibt es nur bei tatsächlich fehlgeschlagenen Anfragen.

Ergebnis im Diagnose-Log nach dem Fix, während des Audio-Syncs: 1,2-1,5 s statt 9-15 s, 3/3 Antworten
jedes Mal, keine Timeouts; die Server-Log-Auswertung bestätigt, dass immer nur noch ein Download läuft
(10,4 s, 5,7 s, 5,0 s, 6,4 s nacheinander).

## 6. OFFEN: die Restlatenz von ca. 1,2 s

**Beobachtung (gemessen):** Solange ein einzelner Track streamt, dauern die Status-Anfragen
1,1-1,5 s statt ~0,15 s im Leerlauf. Der Server beantwortet `/server-info` und
`/server/active-workspace` dabei in 0-1 ms, die Anfragen kommen ohne Verzögerung an - das Tablet meldet
trotzdem `server 1235ms` bis zum ersten Byte. `/workspaces` braucht serverseitig zusätzlich 330-445 ms
(9 ms zwischen zwei Tracks), vermutlich weil es mehrere CouchDB-Aufrufe nacheinander macht, während der
Server Audio sendet.

**Erklärung (Vermutung, nicht direkt gemessen):** Alle Antworten teilen sich eine TCP-Verbindung
(HTTP/2). Während ein Track streamt, liegen bereits ca. 1-2 MB Audio im Sendepuffer bzw. in den
Warteschlangen der Strecke *vor* der winzigen Antwort; bei ca. 10 Mbit/s (Browser-Schätzung: 4g,
10 Mbps, RTT 50-100 ms) dauert das Abfließen ~1 s. Weniger parallele Downloads verkürzt die Phasen,
beseitigt diese Reihenfolge-Sperre aber nicht.

**Aktueller Stand:** bewusst so gelassen (Marcos Entscheidung, 2026-09-18). Es betrifft nur einen
kurzen Refresh während eines Audio-Syncs (nach Band-Wechsel oder neuen Tracks); die UI zeigt dank
Cache sofort den letzten Stand.

### Ideen für später

1. **Downloads in kleinen Häppchen** (z.B. 256 KB per HTTP-Range): dann liegt höchstens ein Häppchen
   vor einer Status-Antwort (~0,2 s bei 10 Mbit/s). Braucht Range-Unterstützung an der Audio-Route
   (`GET /audio/:variantId/:trackId` schickt bisher die ganze Datei) und clientseitig Chunk-Schleife
   plus Zusammenbau des Blobs - ein Eingriff in den Audio-Pfad, der schon mehrfach fragil war
   (docs/10), also mit Tests und Live-Verifikation angehen.
2. **Audio über eine eigene Verbindung** (anderer Port/Hostname): der Sendepuffer der Audio-Antwort
   steht dann nicht mehr vor den kleinen Antworten. Die WLAN-Strecke selbst bleibt geteilt - ob das
   reicht, ist offen. Zertifikat/Origin-Konsequenzen (ein Zertifikats-Tap pro Origin, siehe docs/03 §0a)
   beachten.
3. **Serverseitiges Pacing** der Audio-Antworten (Rate-Limit unterhalb der Streckenkapazität), damit
   Luft für kleine Anfragen bleibt. Braucht eine Vorstellung von der tatsächlichen Streckenrate.
4. **Prüfen, ob die Audio-Route streamt:** liest sie die Datei komplett in den Speicher, statt zu
   streamen? Das würde auch die 330-445 ms von `/workspaces` erklären (Event-Loop-Konkurrenz). Nicht
   geprüft.

**Zum Wiederaufnehmen:** entweder den Diagnose-Code aus der Git-History zurückholen (siehe 4.1) oder
ohne ihn messen - per adb/CDP-Netzwerkaufzeichnung (docs/03 §1a, docs/10 §6.1) oder allein mit dem
Server-Log (4.2: `responseTime` der kleinen Routen gegen gleichzeitig laufende `/audio/...`-Requests
halten). Vergleichswerte: vorher 9-15 s, jetzt ~1,2 s Zeit bis zum ersten Byte während des Audio-Syncs,
im Leerlauf ~0,15 s.

## Verwandte PRs

#236 (Band-Wechsel), #238-#239 (Wizard, PIN-Prüfung serverseitig), #240 (dieser Fix; enthielt den
inzwischen wieder entfernten Diagnose-Schalter)
