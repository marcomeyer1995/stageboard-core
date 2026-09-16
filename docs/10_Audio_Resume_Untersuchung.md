# Audio-Resume nach Tablet-Reload: Untersuchung vom 2026-09-16

Diese Datei dokumentiert eine mehrstündige Live-Debugging-Session zu #229 (Backing-Track verliert
nach einem Tablet-Reload dauerhaft die Wiedergabe), ausgelöst durch Marcos Beobachtung, dass ein
Reload während eines laufenden Songs den Backing-Track lautlos und dauerhaft verstummen ließ. Ziel:
falls das Thema erneut aufkommt (neue Hardware, ähnliches "Wiedergabe reagiert komisch"-Symptom),
hier zuerst nachschlagen statt bei Null anzufangen.

**Kurzfassung:** Drei unabhängige, sich gegenseitig überlagernde Ursachen gefunden und in vier
Runden behoben (#224-#228): eine stillschweigend blockierte Autoplay-Policy, ein Lade/Abspiel-Race
plus ein durch 60fps-Re-Renders unreaktiver Button, und zuletzt eine Cache-Reconciliation, die sich
selbst mehrfach überlappend auslöste und dabei den gesamten Song-Katalog wiederholt parallel neu
herunterlud. Am Ende (verifiziert per Live-Reproduktion auf Marcos Tablet): Resume nach Reload
dauert noch ~1-2s statt dauerhaft auszufallen oder mehrere Sekunden zu hängen.

## 1. Ausgangslage

Marcos Beobachtung: Ein Tablet, das gerade Gig-Mode-Audio lokal abspielt (dieses Gerät als
`audio-playback`-Ausgabe gebunden, `localAudioEngine.ts`), verliert nach einem Reload während des
laufenden Songs die Wiedergabe komplett - kein Fehler, keine Anzeige, einfach Stille, obwohl
`ShowState` weiterhin "playing" zeigt.

## 2. Runde 1 - Autoplay-Policy blockiert stillschweigend (#224)

**Problem:** `useAudioOutputDriver.ts` versucht beim Reload korrekt, die Wiedergabe an der
richtigen Position automatisch fortzusetzen - aber dieser `audio.play()`-Aufruf hat keine
User-Geste hinter sich, also blockiert ihn Chromes Autoplay-Policy mit einer Ablehnung
(`NotAllowedError`). Der alte Code schluckte *jede* Ablehnung von `audio.play()` unbedingt (auch
die harmlose `AbortError`-Variante bei einem schnellen Doppel-Tap), sodass nichts den Fehlschlag
sichtbar machte.

**Fix:** `localAudioEngine.ts`s `playLocalTrack` unterscheidet jetzt `AbortError` (harmlos) von
einer echten Ablehnung und meldet sie zurück. Ein neues, global in `App.tsx` gemountetes
`AudioResumeOverlay` blockiert bei einer Ablehnung den ganzen Bildschirm mit einem
"Antippen zum Fortsetzen"-Button - bewusst kein dezentes Banner in nur einem Widget, da die Person
am Tablet gerade ein ganz anderes Widget (Prompter, Setlist) im Blick haben könnte.

- PR: #224 (gemerged)
- Quelldateien: `packages/stage-pwa/src/lib/localAudioEngine.ts`,
  `packages/stage-pwa/src/lib/useAudioOutputDriver.ts`,
  `packages/stage-pwa/src/store/useLocalAudioOutputStore.ts`,
  `packages/stage-pwa/src/components/AudioResumeOverlay.tsx`

## 3. Runde 2 - Der Button selbst reagierte erst nach mehreren Tipp-Versuchen (#225)

**Problem:** `AudioResumeOverlay` las `elapsedMs` reaktiv über `useShowMode()`, das über
`usePlaybackElapsedMs.ts` per `requestAnimationFrame` tickt - bis zu 60x/Sekunde, solange
`playbackStatus` "playing" bleibt (was es die ganze Zeit tut, in der das Overlay sichtbar ist, da
die blockierte Wiedergabe `ShowState` nicht ändert). Das rendert das Overlay 60x/Sekunde neu, nur
um einen statischen Screen anzuzeigen - und konkurriert dabei mit dem Hauptthread genau um das
Touch-Event, das der Button eigentlich auffangen soll.

**Fix:** Das Overlay abonniert `elapsedMs` gar nicht mehr reaktiv, sondern liest die aktuelle
Song-Position nur noch imperativ im Moment des Taps selbst (dieselbe `computeActiveMs`-Berechnung
wie `usePlaybackElapsedMs.ts`, nur ohne dessen `requestAnimationFrame`-Abonnement).

- PR: #225 (gemerged)
- Quelldatei: `packages/stage-pwa/src/components/AudioResumeOverlay.tsx`

## 4. Runde 3 - Abspielen lief dem Laden davon (#226)

**Problem:** `useAudioOutputDriver.ts`s Lade-Effekt (`loadLocalTrack`, ein asynchroner
PouchDB-Blob-Fetch) und sein Abspiel-Effekt (`playLocalTrack`) feuern bewusst unabhängig
voneinander (sie dürfen sich kein gemeinsames Dependency-Array teilen, siehe Kommentar in der
Datei). Bei einem frischen Reload feuern beide im selben Tick - der automatische Abspielversuch
lief also fast immer los, *bevor* der Blob überhaupt fertig geladen war, und scheiterte an einem
`<audio>`-Element ohne gültige Quelle. Diese Ablehnung hat nichts mit der Autoplay-Policy zu tun,
wurde aber genauso als "blockiert, bitte antippen" gemeldet - und ein zu früher manueller Tap
konnte demselben Rennen zum Opfer fallen und wieder scheitern, bis das Laden im Hintergrund
irgendwann leise fertig wurde.

**Fix:** `playLocalTrack` wartet jetzt auf einen eventuell noch laufenden `loadLocalTrack`-Aufruf,
bevor es das Audio-Element anfasst - behebt sowohl den automatischen Versuch als auch den
manuellen Tap im Overlay an einer einzigen Stelle.

- PR: #226 (gemerged)
- Quelldatei: `packages/stage-pwa/src/lib/localAudioEngine.ts`

## 5. Runde 4 - Cache-Eviction und ein sich selbst überlappender Reconciler (#227, #228)

Auch nach den ersten drei Fixes blieb eine Verzögerung von ~6-8 Sekunden zwischen Tap und
tatsächlichem Wiedereinsetzen der Wiedergabe.

**Teilursache 1 - Eviction eines aktiv spielenden Tracks:** `audioStorageManager.ts`s
Cache-Reconciler orientiert sich rein am Sync-Modus (None/Selective/Full) - je nach Modus konnte
er den gerade aktiv spielenden Track aus dem lokalen Cache entfernen (z.B. sofort nach dem
erstmaligen Abspielen, oder weil eine "Full"-Synchronisierung ihn schlicht noch nicht eingeholt
hatte). Ein Reload musste dann den kompletten Track erneut über das Netz laden.

**Fix:** `computeTargetKeys`/`reconcileAudioCache` nehmen jetzt ein `alwaysKeepKeys`-Set entgegen,
das unabhängig vom Sync-Modus (auch bei "None") immer in die Zielmenge einfließt - der aktuell
spielende Track wird nie evictet und zusätzlich vorrangig (vor dem Rest eines großen
"Full"-Katalog-Syncs) geladen.

- PR: #227 (gemerged)
- Quelldateien: `packages/stage-pwa/src/lib/audioStorageManager.ts`,
  `packages/stage-pwa/src/lib/useAudioSyncReconciler.ts`

**Teilursache 2 - mehrere Reconciliation-Läufe überlappen sich (der eigentliche Haupttreiber der
6-8s):** Gefunden erst durch eine gezielte Live-Netzwerk-Aufzeichnung (Abschnitt 6.1) - nicht
durch Code-Lesen allein. `useAudioSyncReconciler.ts`s Effekt feuert während der initialen
PouchDB-Synchronisierung mehrfach kurz hintereinander (`variants`/`activeSetlist` bekommen bei
jedem eintreffenden Sync-Batch eine neue Referenz). Jede Feuerung startete unabhängig einen
kompletten "Full"-Modus-Katalog-Reconcile, ohne dass irgendetwas Überlappung verhinderte - die
Aufzeichnung zeigte mehrere vollständige Bursts derselben ~20 Tracks (je 3-9MB), die parallel
mehrfach neu heruntergeladen wurden und sich dabei gegenseitig die Bandbreite wegnahmen. Selbst der
eigentlich priorisierte Track hing hinter diesem selbstgemachten Stau fest, weil "Priorität" nur
*innerhalb* eines einzelnen Reconcile-Laufs wirkte, nicht zwischen mehreren gleichzeitig laufenden.

**Fix:** Neue Funktion `scheduleReconcileAudioCache` serialisiert die Aufrufe - läuft bereits ein
Reconcile, wird nur der jeweils letzte Satz Eingabewerte gemerkt, und nach Abschluss des laufenden
Durchgangs läuft genau ein weiterer, statt mehrerer parallel rennender. `useAudioSyncReconciler.ts`
ruft jetzt diese Funktion auf statt `reconcileAudioCache` direkt.

- PR: #228 (gemerged)
- Quelldatei: `packages/stage-pwa/src/lib/audioStorageManager.ts`

## 6. Methodik für künftige Live-Diagnosen dieser Art

### 6.1 CDP-Netzwerk-Aufzeichnung über adb (neues Muster, Ergänzung zu docs/03 §1a)

Für "es dauert lange, aber ich weiß nicht wobei" reicht ein Konsolen-Log nicht - hier braucht es
die tatsächlichen Netzwerk-Timings. Ad-hoc-Skript (nicht Teil von `scripts/`, da einmalig gebaut,
aber jederzeit reproduzierbar): über dieselbe CDP-WebSocket-Verbindung wie
`scripts/tablet-debug.mjs` zusätzlich `Network.enable` senden und auf
`Network.requestWillBeSent`/`responseReceived`/`loadingFinished`/`loadingFailed` lauschen, jeweils
mit Zeitstempel und URL mitgeschrieben. Marco reproduziert währenddessen live am Gerät, das Log
zeigt danach exakt: welche Requests wann starten, wie lange jeder einzelne braucht (inkl.
Byte-Größe), und ob mehrere Bursts sich zeitlich überlappen. Genau diese Aufzeichnung hat
Teilursache 2 aus Abschnitt 5 sichtbar gemacht - ohne sie wäre das reine Vermuten geblieben
("vielleicht Netzwerk, vielleicht Cache-Timing").

### 6.2 Cache-Inhalt direkt per CDP `Runtime.evaluate` prüfen

Bevor man tiefer im Code sucht: den tatsächlichen IndexedDB-Inhalt auf dem Gerät direkt abfragen
(`indexedDB.open('stageboard-audio-cache', 1)` + `getAllKeys()` über `Runtime.evaluate`, dieselbe
Verbindung wie `tablet-debug.mjs eval`). Bestätigt in Sekunden, ob eine "wird nicht gecacht"-Theorie
überhaupt zutrifft, statt sie erst über mehrere Code-Lese-Runden zu verifizieren.

### 6.3 Origin-Speicher-Falle: `stageboard.local` vs. rohe IP

Browser-Storage (IndexedDB, und damit dieser Audio-Cache) ist strikt pro **Origin**
(Schema+Host+Port) getrennt. `https://stageboard.local` und `https://192.168.178.158` sind
derselbe physische Server, aber zwei komplett getrennte Storage-Bereiche aus Sicht des Browsers -
ein Wechsel zwischen beiden (z.B. weil `.local` auf einem Gerät nicht auflöst, siehe 6.4) bedeutet
einen leeren Cache auf der "neuen" Origin, unabhängig davon, was vorher unter der anderen Adresse
gecacht war. Beim Testen/Reproduzieren von Cache-Verhalten immer dieselbe Origin durchgehend
verwenden, sonst sieht ein leerer Cache wie ein Bug aus, ist aber nur ein Origin-Wechsel.

### 6.4 `.local` auf Windows/Android (Verweis)

Siehe docs/03 §0a - Windows und Android lösen `.local`-mDNS-Namen im Browser nicht zuverlässig auf
(nur macOS/iOS und Linux). "stageboard.local ist nicht erreichbar" auf einem dieser Geräte ist kein
Server-Problem - die rohe IP funktioniert stattdessen immer.

## 7. Ergebnis

Verifiziert live auf Marcos Tablet, nach allen fünf PRs: Ein Reload während eines laufenden Songs
zeigt kurz das `AudioResumeOverlay`, ein Tap darauf setzt die Wiedergabe innerhalb von ~1-2s fort
(die verbleibende Zeit ist das normale Neu-Seeken/Puffern des `<audio>`-Elements, kein
Reconciliation- oder Netzwerk-Overhead mehr) - statt des ursprünglichen dauerhaften, lautlosen
Ausfalls.

## Verwandte PRs & Issue

#229 (zusammenfassendes, geschlossenes Issue), #224, #225, #226, #227, #228
