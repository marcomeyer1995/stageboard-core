# Developer Experience (DX) & KI-Integration

Da das Projekt hochkomplex ist (Hardware, Plugins, Timecode) und mithilfe von KI-Agenten (wie Claude Code) entwickelt werden soll, muss die Architektur von Beginn an auf Testbarkeit, strikte Typisierung und Beobachtbarkeit (Observability) ausgelegt sein.

## 0. Node.js-Version: via nvm, gepinnt in `.nvmrc`

Node wird über [nvm](https://github.com/nvm-sh/nvm) verwaltet (installiert unter `~/.nvm`), nicht über das System-`apt`-Paket — Ubuntus eigenes Repo bietet nur ein eingefrorenes Node 18 an, das seit April 2025 keine Sicherheitspatches mehr bekommt. Die Projekt-Node-Version steht in `.nvmrc` (aktuell 24, aktuelle LTS). In einem neuen Terminal `nvm use` ausführen, um sie zu aktivieren; `nvm alias default 'lts/*'` ist bereits gesetzt, neue Shells sollten automatisch auf der richtigen Version starten.

Alle Kern-Pakete laufen auf ihren aktuellen Major-Versionen (Fastify 5, Vite 8, Vitest 4) — keine künstlichen Downgrades mehr nötig.

**Bekannte Stolperfalle:** In manchen (insbesondere nicht-interaktiven) Shells ist die Umgebungsvariable `npm_config_prefix` bereits gesetzt (z.B. auf `/usr/local`). nvm verweigert dann das automatische Aktivieren der Default-Version beim Sourcen und meldet das nur als Warnung, nicht als Fehler. Fix: `unset npm_config_prefix` **vor** dem Sourcen von `nvm.sh` ausführen, dann `node --version` zur Kontrolle prüfen.

## 0a. HTTPS für lokale Entwicklung (secure context, #34)

`getUserMedia()` (Tuner) und `requestMIDIAccess()` (WebMIDI) verlangen einen Secure Context - reines HTTP reicht nicht, auch nicht über eine LAN-IP. Da Offline-Bühnen-Router kein Let's-Encrypt-Zertifikat erneuern können, läuft das über ein einziges, selbstsigniertes Zertifikat, das sich Vite, Fastify und CouchDB teilen:

```
./scripts/generate-dev-certs.sh          # nur localhost/127.0.0.1
LAN_IP=192.168.x.x ./scripts/generate-dev-certs.sh   # + LAN-Adresse für Tablets
```

Schreibt `certs/dev-cert.pem` + `certs/dev-key.pem` (gitignored, pro Maschine neu erzeugt). `vite.config.ts` und `packages/core-backend/src/index.ts` lesen diese Dateien selbst und schalten automatisch auf HTTPS um, sobald sie existieren - **graceful fallback**: ohne generierte Zertifikate läuft alles wie bisher über HTTP, nichts crasht. CouchDB braucht das Docker-Volume-Mount aus `docker-compose.yml` (`docker/couchdb-ssl.ini`, `[ssl] enable = true`) und liefert HTTPS zusätzlich zu HTTP auf Port 6984, ohne 5984 abzuschalten.

Sobald HTTPS aktiv ist: `.env` auf `https://` für `VITE_STAGE_SERVER_URL` umstellen (siehe `.env.example`), und `FRONTEND_ORIGIN` beim Start von `core-backend` auf die passende(n) HTTPS-Origin(s) setzen (`FRONTEND_ORIGIN="https://localhost:5173,https://<lan-ip>:5173"`) - sonst schlägt CORS fehl, weil der Default (`http://localhost:5173`) bewusst nicht automatisch mitwechselt (der CORS-Test in `index.test.ts` hängt an diesem stabilen Default). `FRONTEND_ORIGIN`/CORS ist nur relevant, solange Vites eigener Dev-Server läuft (`npm run dev` in `stage-pwa`) - siehe unten.

**Ein Origin statt drei (2026-09-02, vierter Follow-up, auf Marcos ausdrücklichen Wunsch):** Browser vertrauen einem selbstsignierten Zertifikat pro *Origin* (Schema+Host+Port), nicht pro Zertifikatsdatei - obwohl Vite, Fastify und CouchDB dieselbe Zertifikatsdatei teilen, brauchte jedes neue Tablet trotzdem bis zu drei separate "Trotzdem fortfahren"-Taps (einen je Port). `core-backend` proxied CouchDB-Traffic jetzt selbst unter einem `/db`-Prefix (`index.ts`, `@fastify/http-proxy` - reiner Passthrough, das eigene Basic-Auth-Header jedes Geräts geht unverändert an CouchDB durch, nichts an der eigentlichen Autorisierung ändert sich) und kann zusätzlich `stage-pwa`s Build-Output selbst ausliefern (`@fastify/static`, nur falls `packages/stage-pwa/dist` existiert - `npm run dev` mit Vite bleibt für die alltägliche Entwicklung unverändert nutzbar). `VITE_COUCHDB_URL` gibt es dementsprechend nicht mehr - `workspaceDb.ts` leitet die CouchDB-URL direkt aus `VITE_STAGE_SERVER_URL` ab (`+ /db/<dbname>`).

Für den "wie ein echtes Gerät"-Test bzw. einen echten Gig: `npm run build` in `stage-pwa`, dann `core-backend` starten (liest `packages/stage-pwa/dist` automatisch) und Tablets nur noch auf den einen Stage-Server-Port zeigen lassen. Jedes Tablet braucht dann nur noch einen einzigen manuellen "Trotzdem fortfahren"-Tap beim ersten Aufruf (selbstsigniert, keine CA) - danach merkt sich der Browser die Ausnahme für alles: App, API und Datenbank-Sync.

**Ein Name statt einer IP, kein Port (2026-09-02, fünfter Follow-up, auf Marcos ausdrücklichen Wunsch):** Eine echte Domain wie `stage.board` würde einen echten DNS-Server und damit Internetzugang am Gig-Ort voraussetzen - genau das, was die "Zero-Friction Stage Requirement" (docs/02) bewusst ausschließt (Offline-Bühnen-Router können ohnehin kein Let's-Encrypt-Zertifikat erneuern). Die Lösung, die ohne jede Infrastruktur auf praktisch jedem Gerät funktioniert, ist mDNS - derselbe Mechanismus, über den AirPlay/Chromecast/Netzwerkdrucker sich per Namen statt IP finden lassen, aber auf den `.local`-Suffix beschränkt (nur den lösen Browser/Betriebssysteme automatisch auf). Kollidiert nicht mit einem normalen DNS-Server im selben Netz (z.B. einer FritzBox) - `.local` ist genau dafür reserviert (RFC 6762): Resolver behandeln die Endung als Sonderfall und fragen dafür nie den regulären DNS-Server. Der einzige reale Risikofaktor ist WLAN-Client-/AP-Isolation (üblich bei Gäste-Netzen/Hotels), die Multicast-Traffic zwischen Geräten blockiert - dagegen hilft nur, es zu wissen und notfalls auf die rohe IP auszuweichen.

`core-backend` beantwortet `.local`-Anfragen inzwischen selbst (`index.ts`, das npm-Paket `multicast-dns`) - kein `avahi`/`/etc/avahi/hosts` mehr nötig. Der ursprüngliche Versuch darüber ist an einem dokumentierten Avahi-Bug gescheitert ([avahi/avahi#40](https://github.com/avahi/avahi/issues/40)): ein statischer `/etc/avahi/hosts`-Eintrag kollidiert dort zuverlässig mit dem eigenen Reverse-DNS-Record der Maschine für dieselbe Adresse. Der eigene Responder in `core-backend` beantwortet stattdessen einfach direkt die eine Anfrage, die zählt ("wer ist `stageboard.local`") - kein Probe/Announce/Konfliktabgleich wie bei echtem mDNS-Discovery, also auch nicht anfällig für diesen Bug. Startet automatisch mit dem Server und baut sich sein UDP-Socket selbst zusammen (`createMdnsSocket` in `index.ts`), statt es der Bibliothek zu überlassen: deren eigene Auswahl des Sende-Interfaces war auf dieser Maschine (Docker-eigene virtuelle Netzwerk-Interfaces neben dem echten) unzuverlässig - Anfragen kamen zwar an, Antworten haben aber nie ein reales Gerät im LAN erreicht (live gefunden). `setMulticastInterface(lanIp)` fest zu setzen behebt das; auf `lanIp` statt der Wildcard-Adresse zu *binden* dagegen bricht auf Linux das Empfangen von Multicast-Traffic komplett (auch das live gefunden) - beides sieht ähnlich aus, ist aber ein grundverschiedener Teil des Socket-Setups. `LAN_IP` steuert dabei sowohl die zurückgegebene Adresse als auch dieses Sende-Interface; kein zusätzliches System-Setup mehr nötig.

**Grenzen von `.local` im Browser (wichtig für die Praxis):** Verlässlich funktioniert das nur auf Geräten mit eingebauter mDNS-Unterstützung im Betriebssystem selbst - macOS/iOS (natives Bonjour) und Linux mit korrekt eingerichtetem Resolver (wie diese Dev-Maschine, `nsswitch.conf`s `mdns4_minimal`). **Windows und Android lösen `.local`-Namen im Browser (und selbst per `ping`, am Betriebssystem-Resolver vorbei am Browser getestet) standardmäßig nicht auf** - live an einem Windows-PC (Edge *und* Firefox, sowie `ping stageboard.local` direkt in der Kommandozeile) und einem Android-Tablet bestätigt, nachdem die Interface-Bugs oben bereits behoben waren. Das ist keine Einschränkung dieses Servers, sondern eine Lücke in den jeweiligen Betriebssystem-Netzwerkstacks selbst - dagegen hilft server-seitig nichts. Für den eigentlichen "neues Mitglied tritt bei"-Weg zählt das ohnehin nicht: der QR-Code (`InviteBandView.tsx`, RosterSetupView.tsx's Abschlussbildschirm) codiert direkt die rohe IP, ganz ohne Namensauflösung - der zuverlässige Weg für praktisch jedes Gerät, unabhängig von alledem. `stageboard.local` bleibt die Komfortabkürzung für eigene Admin-Geräte (Mac/Linux), nicht der primäre Weg für die ganze Band.

Zwei einmalige, pro Maschine auszuführende Setup-Schritte bleiben auf der Stage-Server-Maschine (nicht auf den Tablets - die brauchen wie immer nur den einen "Trotzdem fortfahren"-Tap):

1. **Port 443 statt 3001** (damit der Name allein reicht, ganz ohne `:3001` in der Adresse - Browser probieren bei `https://` ohnehin automatisch Port 443): Ports unter 1024 sind privilegiert, ein normaler `node`-Prozess darf sie ohne Weiteres nicht binden. Einmalig, pro `node`-Binary (bei jedem `nvm install` einer neuen Version erneut nötig):
   ```
   sudo setcap 'cap_net_bind_service=+ep' "$(readlink -f "$(which node)")"
   ```
   Danach `core-backend` mit `PORT=443` und `LAN_IP=<Stage-Server-IP>` starten - `packages/stage-pwa/.env`s `VITE_STAGE_SERVER_URL` entsprechend auf `https://stageboard.local` (ohne Port) setzen und `stage-pwa` neu bauen, da Vite Umgebungsvariablen zur Build-Zeit fest einbackt, nicht zur Laufzeit liest.
2. **SAN im Zertifikat** - bereits erledigt: `scripts/generate-dev-certs.sh` nimmt `stageboard.local` automatisch als zusätzlichen SAN mit auf, das gemeinsame Zertifikat deckt den Namen also schon ab, ohne einen zweiten Zertifikats-Tap zu erzwingen.

Ein Gerät, das die nackte Domain ohne Schema eintippt (`stageboard.local` statt `https://stageboard.local`), bekommt vom Browser oft `http://` geraten - dafür lauscht `core-backend` zusätzlich auf Port 80 und leitet direkt auf `https://` um (derselbe Server, dieselbe `LAN_IP`/Port-443-Grundlage, kein weiterer Setup-Schritt).

## 1. Die Logging- & Debug-Strategie (Home Assistant Style)
Um bei zig parallelen Plugins den Überblick zu behalten, reicht ein einfaches `console.log` nicht aus. Wir nutzen Structured Logging (z.B. mit Pino oder Winston im Backend).

* **JSON-Format & Metadaten:** Jeder Log-Eintrag wird als JSON gespeichert und bekommt zwingend Metadaten angeheftet: Zeitstempel, Loglevel (DEBUG, INFO, WARN, ERROR), `source` (Core oder Name des Plugins) und eine `correlation_id` (um Events über mehrere Stationen zu verfolgen).
* **Die Live-Debug-Console:** Das Frontend (PWA) bekommt – versteckt hinter einem Entwickler-Menü – eine Live-Konsole (wie bei Home Assistant). Hier laufen die Logs aller verbundenen Geräte und Plugins in Echtzeit auf.
* **Plugin-Sandboxing:** Stürzt ein schlecht programmiertes Community-Plugin ab, darf das nicht den Core (Stage-Server) mitreißen. Plugins laufen isoliert (z.B. in separaten Worker-Threads). Der Core fängt den Crash ab, deaktiviert das Plugin automatisch, schreibt einen FATAL-Log und hält die restliche Show am Laufen.

### 1a. Live-Tablet-Debugging (bis die Live-Debug-Console existiert)

Manche Bugs zeigen sich nur auf dem Tablet - Touch-Drag-Timing, Geometrie bei echten
Bildschirmgrößen, Dinge, die sich am Laptop nicht reproduzieren lassen (siehe
[[stageboard-lan-testing]] für das LAN-Setup selbst). Bis es die oben skizzierte
Live-Debug-Console gibt, hat sich dieses Vorgehen bewährt und sollte für neue
tablet-only Bugs wiederverwendet werden:

1. **Togglable Debug-Logger pro Feature**, nicht dauerhaft aktives `console.log`. Muster
   siehe `packages/stage-pwa/src/lib/gridDebug.ts`: ein `localStorage`-Flag
   (`sb:debug:<feature>`), aus für normale Nutzung, und ein `gridLog(...)`-Wrapper mit
   festem `[grid]`-Tag-Präfix, den man an den relevanten Stellen (State-Übergänge,
   die interessante Zwischenwerte einer live laufenden Berechnung) platziert. Für ein
   neues Feature dieselbe Datei kopieren/anpassen statt eine gemeinsame Abstraktion zu
   bauen - der Tag-Präfix ist es, was das Filtern später erlaubt.
2. **Tablet per adb verbinden:** USB-Debugging in den Android-Entwickleroptionen aktivieren,
   Kabel anschließen, am Tablet den "USB-Debugging erlauben?"-Dialog bestätigen. Zeigt
   `adb devices` das Gerät als `no permissions (missing udev rules?)` statt `device`, fehlt
   eine udev-Regel für die Vendor-ID (per `lsusb` ermitteln): eine Zeile wie
   `SUBSYSTEM=="usb", ATTR{idVendor}=="<vendor-id>", MODE="0666", GROUP="plugdev"` nach
   `/etc/udev/rules.d/51-android.rules`, dann `sudo udevadm control --reload-rules && sudo udevadm trigger`
   und neu einstecken. (`sudo` braucht ein echtes Terminal - der `!`-Präfix in Claude Code
   liefert keins, dafür also ein eigenes Terminal-Fenster nutzen.)
3. **CDP-Port weiterleiten:** `adb forward tcp:9222 localabstract:chrome_devtools_remote` -
   danach ist die Chrome-DevTools-Protocol-Schnittstelle des Tablet-Chrome unter
   `localhost:9222` erreichbar, ganz ohne die `chrome://inspect`-GUI.
4. **`scripts/tablet-debug.mjs`** treibt das von dort aus:
   * `node scripts/tablet-debug.mjs list` - offene Tabs auf dem Tablet auflisten.
   * `node scripts/tablet-debug.mjs eval "5173" "localStorage.setItem('sb:debug:grid','1'); location.reload()"` -
     das Debug-Flag setzen und neu laden, ohne das Tablet in die Hand zu nehmen.
   * `node scripts/tablet-debug.mjs watch "5173" out.txt grid` - den Live-Log-Stream des
     Tablets (gefiltert auf das Tag) mitschneiden, während der Bug am Gerät reproduziert wird.
5. **Reproduzieren lassen, Log lesen.** Die Person am Tablet triggert das Problem; das
   mitgeschnittene Log zeigt den genauen Frame-für-Frame-Zustand - oft aussagekräftiger
   als eine Bildschirmbeschreibung, gerade bei Timing-/Reihenfolge-Bugs.

Damit ließ sich z.B. ein Widget-Resize-Flackern beim Drag-and-Drop (Kompaktierung, die auf
jedem Drag-Frame neu und ohne Gedächtnis an den letzten Frame gelöst wurde, plus ein
`compactType`-Detail von react-grid-layout, das den Aktiv-Widget selbst verschob) direkt am
Gerät nachvollziehen, statt raten zu müssen.

## 2. Testing-Strategie (Hardware-Abstraktion)
KI-Entwicklung funktioniert am besten mit Test-Driven Development (TDD). Die Herausforderung: Die KI (und die CI/CD-Pipeline) hat physisch keinen Kemper-Amp und kein Soundcraft-Mischpult angeschlossen.

* **Interface-First (Ports & Adapters):** Das System muss zwingend nach der Hexagonalen Architektur aufgebaut sein. Der Kern kommuniziert nie direkt mit einem USB-Port, sondern immer nur über ein Interface (z.B. `IMidiSender`).
* **Hardware-Mocks (Dummys):** Für jedes Plugin schreiben wir zuerst einen Mock. Beispiel: Das Pult-Plugin bekommt einen simulierten Endpunkt, der einfach nur mit `{ status: "ok", volume: 5 }` antwortet. So können Claude und die automatischen Tests das In-Ear-Routing überprüfen, ohne dass ein echtes Mischpult im Raum steht.

## 3. KI-Entwicklung: Der MCP-Server (Model Context Protocol)
Um Claude Code effektiv als Co-Developer einzusetzen, bauen wir einen internen MCP-Server (nur für die Entwicklungsphase). Dieser Server gibt Claude kontextbezogene "Augen und Hände" in unserem Projekt.

**Mögliche MCP-Tools für Claude:**
Claude bekommt über den MCP-Server Zugriff auf folgende Werkzeuge:
1. `read_plugin_schema()`: Claude kann das standardisierte JSON-Schema (die API-Vorgabe) für neue Plugins auslesen, um zu wissen, wie er ein neues bauen muss.
2. `fetch_latest_logs(level="ERROR")`: Wenn du Claude sagst: "Das MIDI-Plugin crasht", ruft Claude selbstständig dieses Tool auf, holt sich die letzten Error-Logs aus dem Backend und analysiert den Stacktrace.
3. `simulate_trigger(event="midi_pedal_press", payload=...)`: Claude kann einen virtuellen Fußtritt in das System injizieren, um zu testen, ob der Timecode korrekt reagiert.
4. `run_test_suite(target="core/timecode")`: Claude schreibt Code und feuert danach selbstständig dieses Tool ab, um zu prüfen, ob er etwas kaputt gemacht hat.

## 4. Vorgehensweise & Struktur für die KI-Generierung
Damit die KI nicht halluziniert oder sich in Spaghetticode verheddert, braucht sie strikte Leitplanken:

* **Strikte Typisierung (TypeScript & Zod):** Jede Kommunikation zwischen Core und Plugins muss über validierte Zod-Schemas laufen. Wenn die KI ein Plugin schreibt, das ein falsches Datenformat sendet, wirft Zod sofort einen Fehler, den die KI über den MCP-Server auslesen und korrigieren kann.
* **Modularer Aufbau (Kleine Dateien):** KI-Modelle haben begrenzte Kontext-Fenster. Ein Plugin darf keine 3000-Zeilen-Datei sein. Logik (Was passiert?), State (Wie speichere ich es?) und I/O (Wie sende ich es an Hardware?) müssen in winzige, separat testbare Dateien zerlegt werden.

**Der Prompt-Workflow:**
1. Du sagst: "Schreibe ein Plugin für das Behringer X32."
2. Claude (via MCP): Liest das Core-Interface `IPlugin`, liest das Mock-Schema für Audio-Router.
3. Claude: Erstellt zuerst die Tests (`x32_plugin.test.ts`).
4. Claude: Implementiert die Logik.
5. Claude (via MCP): Führt die Tests aus, sieht einen Fehler, korrigiert ihn selbstständig und präsentiert dir das fertige Plugin.

## 5. GitHub als Zentrale & Claude Code Integration
Das gesamte Projektmanagement, die Versionierung und die Plugin-Verwaltung finden strikt auf GitHub statt. Dies ist nicht nur für die Open-Source-Community essenziell, sondern auch der wichtigste Hebel für die Entwicklung mit KI:

* **Direkter Repo-Zugriff:** Claude (z.B. über die `claude-code` CLI) läuft lokal in deiner Entwicklungsumgebung und hat direkten Lese- und Schreibzugriff auf das geklonte GitHub-Repository.
* **Issue-Driven Development:** Du erstellst Anforderungen als GitHub Issues. Du gibst Claude den simplen Befehl: "Setze Issue #42 um". Claude analysiert das Issue, sucht die relevanten Dateien im Repo, schreibt den Code, führt die lokalen Tests aus und erstellt selbstständig einen Git-Commit.
* **CI/CD Integration:** Das Repository nutzt GitHub Actions. Sobald Code gepusht wird, laufen Linter, Typ-Checks und Tests. Claude kann als Agent auf diese Pipeline-Ergebnisse reagieren und Fehler selbstständig nachbessern, bevor ein Pull Request für ein neues Plugin in den Core gemerged wird.