# 16 · Markt und Vermarktung

Stand 2026-10-08, ergänzt 2026-10-13 (BandHelper korrigiert, Ableton-Rig ergänzt, Positionierung §1a, Interviewleitfaden §4; ausführlicher Vergleich in docs/20). Erste Überlegung, kein Beschluss: Gibt es StageBoard schon, und was braucht es, um App und Stage-Server an andere Bands zu verkaufen? Rechtliche Punkte sind eine Struktur zum Weiterklären, keine Rechtsberatung (Steuerberater und IT-/Markenanwalt einbeziehen).

## 1. Marktrecherche: Gibt es das schon?

Kurz: **Teile ja, das Ganze nein.** Mehrere Apps decken einzelne Bereiche ab, einige davon viel. Keine bietet den Kern von StageBoard: einen Band-Server im Proberaum, der alle Geräte offline synchron hält, während jedes Gerät seine eigene Aufgabe erfüllt. Fertig eingerichtet als Box verkauft so etwas niemand.

| Produkt | Was es kann | Sync / Plattform | Preis | Unterschied zu StageBoard |
|---|---|---|---|---|
| **BandHelper** (nächster Konkurrent, „Industriestandard“) | Texte, Akkorde, Setlists, Backing-Tracks, Klick, MIDI/OSC, frei gestaltbare Layouts, Band-Verwaltung (Termine, Kontakte, Finanzen, Bühnenpläne) | Cloud-Sync; auf der Bühne „Live Sharing“ von einem Leitgerät: **Bildschirm spiegeln** (1–3 s, Folgegeräte können nichts selbst) oder **Aktionen folgen** (~0,5 s, jedes Gerät behält eigenes Layout, folgt v. a. der Songwahl) - laut BandHelper **nicht für präzises Timing** | Abo; Band mit 2–5 Leuten 40–80 $/Jahr | Keine gemeinsame Uhr: Zeitkritisches nur auf dem einen Abspielgerät; Leitgerät ist Single Point of Failure; Hardware nur als Port/Kanal; keine In-Ear-Steuerung |
| **Ableton-Rig** (Ableton Live + AbleSet) | Profi-Standard: Stems, Klick, Ansagen, MIDI/OSC/LTC auf einer Zeitleiste; AbleSet als Setlist-, Text- und Bühnen-Oberfläche im Browser, eigene Ansicht je Gerät | Ein Rechner spielt alles sample-genau; Tablets sind Anzeige/Fernbedienung; Redundanz über AbleNet mit zweitem Rechner und Umschalt-Interface | Live ca. 279 € + AbleSet 129–269 $ + Rechner/Interface (Redundanz doppelt) | Braucht Ableton-Kenntnisse und meist einen Techniker; Änderungen nur am Rechner; keine Bibliothek/Proben-Werkzeuge; Hardware nur als MIDI-Kanal |
| **Strofa** | ChordPro, Setlists, Backing-Tracks, MIDI, DMX-Licht (Art-Net), Soundcraft-Mischpult, Publikumsbildschirm mit Songwünschen | Cloud; „Live Session“: ein Leiter steuert die Bildschirme der anderen (lokales WLAN nur unter iOS) | 4,99 €/Monat oder 49,99 €/Jahr, keine Gratis-Stufe | Leiter-Folger statt gleichberechtigtem Netz; Android eingeschränkt |
| **StageTracker Pro** | Backing-Tracks (6 Spuren), Klick, Texte, MIDI, Licht | Ein Gerät; kein Band-Sync beschrieben | 3,99 $/Monat | Einzelgerät-App |
| **Show Buddy** (ENTTEC) | Backing-Tracks, Texte, MIDI, DMX-Licht und Video, sehr stark beim Licht | Mac-/Windows-Rechner | Einmalkauf | Show-Rechner, kein Band-Netz |
| **Prime / Playback** (Loop Community / MultiTracks) | Multitracks mit Mixer, Klick und gesprochene Ansagen je Song, Tonart/Tempo live, Abschnitte springen, MIDI-Cues auf der Wellenform (Abo), Anbindung an Folien-/Akkord-Apps | Nur Apple, ein Abspielgerät; Team sieht geteilte Setlists, Akkorde folgen dem Arrangement | App gratis; Abos (Prime Standard/Plus, Playback Premium ab ca. 10 $/Monat); Katalog extra | Lebt vom Verkauf des Track-Katalogs an Kirchen; keine Redundanz; MIDI ohne Clock und ohne Gerätekenntnis |
| **OnSong, forScore, SongbookPro, Band Central** | Texte, Akkorde, Noten, Setlists | Cloud oder einzelnes Gerät | Abo oder Einmalkauf | Keine Show-Steuerung |
| **qPlayer, Livetraker, Cymatic LP-16** (Hardware-Player) | Cue-Player, MIDI/DMX, Backing-Tracks | Ein Gerät | unterschiedlich | Keine Band-Integration |

### Die Lücke

Soweit recherchierbar, verbindet niemand diese vier Dinge:

1. **Local-first-Server mit Offline-Mesh:** Die Band betreibt ihren eigenen Server, beim Gig braucht es kein Internet.
2. **Eine gemeinsame Show-Uhr:** Jedes Gerät weiß, wo im Song die Band gerade ist, und spielt zum selben Zeitpunkt (Clock-Sync, Play 400 ms im Voraus) - nicht nur, welcher Song gewählt ist. Der Drummer hört den Klick, die Sängerin sieht den Text, der Gitarrist bekommt seine Kemper-Wechsel, jeder von seinem eigenen Gerät. Die Konkurrenz löst Timing, indem **ein** Gerät alles spielt und sendet (docs/20 §1).
3. **Hardware-Abstraktion:** Cues gehen an „Marcos Kemper“, nicht an einen Port; In-Ear-Mischpult, Fußschalter und Graceful Degradation, wenn ein Gerät fehlt.
4. **Kein Single Point of Failure ohne doppelte Hardware:** Der Server hält den Zustand, ein anderes Tablet übernimmt die Master-Rolle. Ableton schafft das nur mit zweitem Rechner und Umschalt-Interface (AbleNet).

Weniger einzigartig als zuerst angenommen: **eigene Ansicht pro Gerät** haben BandHelper (Layouts) und AbleSet (Performance View im Browser) auch. Bei uns bleibt eigen, dass die Widgets die Hardware kennen (More Me, Geräte-Status, Sync-Check).

Dazu die **fertige Box**: Heute bauen Bands ihr Rack selbst zusammen (Playback-Rechner, Interface, Mischpult); niemand verkauft es betriebsbereit.

### Die ehrliche Gegenseite

- Die Konkurrenz ist günstig (40–80 $ pro Band und Jahr) und etabliert.
- Den meisten Bands reichen Texte und eine Setlist. Zielgruppe von StageBoard ist das professionellere Ende: Cover- und Eventbands, Bands mit Backing-Tracks, Kirchenbands.
- Der **Worship-Markt** ist groß und zahlt bereits für solche Werkzeuge, deshalb interessant.
- Für die meisten Funktionen gibt es ausgereifte Alternativen; wer alles von einem iPad oder einem Ableton-Rechner spielt, hat präzises Timing schon und braucht unsere Stärke nicht.

## 1a. Positionierung (Stand 2026-10-13)

**Nicht frontal gegen BandHelper antreten.** Breite (Termine, Finanzen, Noten, alle Plattformen) holen wir nicht ein, und BandHelper ist günstig. Ebenso wenig gegen Ableton bei Profi-Produktionen mit Playback-Techniker oder gegen Prime beim Katalog.

**Zielgruppe:** Bands, die mit Tracks, Klick, In-Ears und MIDI-Geräten spielen, die Technik **selbst** betreiben (kein Techniker) und deren Hardware über die Bühne verteilt ist - Cover- und Eventbands, Kirchenbands mit eigenen Songs, Tribute-Shows. Diese Gruppe kauft bereits Hardware (Rack, Interface, In-Ear-System) und ist weniger preisempfindlich.

**Kernbotschaft:** „BandHelper zeigt allen denselben Song. StageBoard spielt allen denselben Song - im selben Moment, jedes Gerät mit seiner eigenen Aufgabe, ohne Kabel quer über die Bühne und ohne ein Gerät, an dem die ganze Show hängt.“ Für Ableton-Nutzer: „Ein Ableton-Rig ohne Ableton-Experten - die Band pflegt alles selbst vom Tablet.“

**Neben statt gegen:** Bands können BandHelper für die Organisation behalten und StageBoard auf der Bühne nutzen. Ein Import (ChordPro, CSV aus BandHelper; Ableton-Locatoren, `.mid`) macht den Umstieg billig.

**Bevor investiert wird (iOS, Box, Lizenz):** Nachfrage prüfen - Leitfaden in §4.

**Technische Hausaufgaben aus dem Vergleich** (docs/20 §8): MIDI-Cues mit Zeitstempel (WebMIDI `send(data, timestamp)`), Cues auf Takten, MIDI Beat Clock, gesprochene Ansagen, Abschnitte springen/loopen, getrennte Ausgänge Klick/Track.

## 2. Was wir für den Verkauf brauchen

### A. Zuerst entscheiden (Blocker)

1. **Code-Lizenz.** Das Repo ist **öffentlich auf GitHub und hat keine Lizenz**. Rechtlich heißt das „alle Rechte vorbehalten“, lesen und kopieren kann den Code trotzdem jeder. Zwei Wege:
   - **Geschlossen:** Repo privat stellen und normal verkaufen.
   - **Open Core, wie Home Assistant mit Nabu Casa:** Der Kern bleibt offen; Geld kommt von der Box, der App, Support und einer Komfort-Cloud.

   Alle Abhängigkeiten sind permissiv lizenziert (MIT, Apache 2.0; eine MPL-2.0-Bibliothek fürs Pitch-Shifting, `@soundtouchjs/audio-worklet`), beide Wege sind also möglich.
2. **Rechtlich riskante Funktionen entfernen oder abtrennen:**
   - **Ultimate-Guitar-Import:** liest deren Webseite aus (Scraping), das verstößt gegen deren Nutzungsbedingungen. In einem kommerziellen Produkt nicht tragbar.
   - **YouTube-Referenzspuren über yt-dlp:** dasselbe Problem mit YouTube.

   Beides fliegt raus oder wird ein separates Plugin, das Nutzer selbst und auf eigene Verantwortung installieren.
3. **Der Name.** Vor jeder Investition „StageBoard“ im deutschen (DPMA) und EU-Markenregister (EUIPO) prüfen. Ein belegter Name kostet später ein Rebranding.

### B. Produktarbeit vor einem Launch

- **iOS-App.** Viele Musiker nutzen iPads; StageBoard gibt es heute nur für Android. Das ist der größte Brocken.
- **Englische Oberfläche.** Heute ist alles Deutsch, es braucht Übersetzungsunterstützung (i18n).
- **Einrichtung ohne Linux-Kenntnisse:** die Box oder ein Installations-Image.
- **Updates für Server im Feld** und eine Backup-Lösung (#363 / PR #405).
- **Beta mit 3–5 fremden Bands.** Die Sicherheitsbefunde vom 2026-10-08 zeigen, dass jemand Externes draufschauen sollte, bevor fremde Daten darauf liegen.

### C. Lizenzmodell: Vorschlag

StageBoard ist keine Einzelgerät-App, die **Band** teilt sich einen Server. Deshalb **pro Band bzw. Server lizenzieren, nicht pro Gerät**:

| Stufe | Inhalt | Preisidee |
|---|---|---|
| **Free** | App gratis in jedem Store. Server für 1 Band mit Texten, Setlists, Prompter, Sync über bis zu 3 Geräte | 0 € |
| **Band** | Unbegrenzt viele Geräte, Backing-Tracks, Klick, MIDI-/Hardware-Cues, In-Ear-Mischpult, Nachbericht | einmalig ~99–149 € plus optionaler Update-Plan, oder ~6–8 €/Monat |
| **StageBoard Box** | Fertiger Rack-Server, Band-Lizenz inklusive, eingerichtet und getestet | Hardware + Marge |
| **Später: Add-ons** | Geräte-Plugins (Kemper, Mischpulte, DMX), Komfort-Cloud (Backup, Fernzugriff) | Kleinbeträge oder Abo |

**Zur Idee „10 Songs gratis“:** Technisch einfach, aber sie blockiert den echten Test. Den Wert von StageBoard sieht eine Band erst mit einer vollen Setlist bei einer echten Probe. Besser: nach **Geräten oder Funktionen** begrenzen, oder **30 Tage voll nutzen** und danach zurück auf Free. In jedem Fall bleiben die eigenen Daten der Band lesbar und exportierbar; gesperrte Daten zerstören Vertrauen.

**Lizenz offline prüfen:** eine signierte Lizenzdatei auf dem Server, lokal geprüft. Die App muss nie „nach Hause telefonieren“, das Local-first-Prinzip bleibt erhalten.

### D. App-Stores und Geld

- **Entwicklerkonten:** Google Play kostet einmalig 25 $; Apple 99 $ pro Jahr. In der EU zeigen die Stores Name und Adresse öffentlich als Anbieter.
- **Wer die Zahlung abwickelt:**
  - Digitale Funktionen, die **in der App** freigeschaltet werden, müssen über das Zahlungssystem von Apple bzw. Google laufen (15 % Provision für kleine Entwickler).
  - Eine Lizenz, die über die **eigene Webseite** für den Server verkauft wird, oder die Box, hat keine Store-Provision. Die App darf dann nicht auf diesen Kauf verlinken (Store-Regeln).
- **Geschäftliche Grundlagen:** Gewerbe anmelden, Steuer klären (anfangs Kleinunternehmerregelung möglich), Impressum und Datenschutzerklärung. Local-first macht den Datenschutz deutlich einfacher.

### E. Die Box verkaufen

In der EU ist man rechtlich **Hersteller** des Gesamtprodukts, auch wenn es aus fertigen Teilen gebaut ist:

- CE-Konformitätserklärung (mit CE-zertifizierten Teilen beginnen);
- WEEE-Registrierung (stiftung ear), bevor in Deutschland Elektrogeräte verkauft werden;
- Verpackungsregistrierung (LUCID) und Produktsicherheitsverordnung (GPSR);
- 2 Jahre Gewährleistung und Support-Aufwand.

Machbar, aber der aufwendigste Teil.

## 3. Vorgeschlagene Reihenfolge

1. Offen oder geschlossen entscheiden, Namen prüfen.
2. i18n und eine Aufwandsschätzung für iOS.
3. Beta mit 3–5 Bands, Kirchenbands eingeschlossen.
4. Preise testen (Free plus Band-Lizenz).
5. Die Box zuletzt, wenn die Software bei Fremden zuverlässig läuft.

## 4. Nachfrage prüfen: Interviewleitfaden

Ziel: herausfinden, ob die Zielgruppe aus §1a das Problem hat, das StageBoard löst, und ob sie dafür zahlt - **bevor** iOS, Box oder Lizenzmodell gebaut werden. 5-10 Gespräche à 20-30 Minuten, möglichst mit Bands, die schon mit Tracks spielen (BandHelper, Prime/Playback, Ableton, iPad mit Playback-App, Hardware-Player).

**Regeln fürs Gespräch:**
- Nach dem fragen, was sie **tatsächlich tun und getan haben**, nicht nach Meinungen über Zukünftiges („Würdest du …?“ liefert höfliche Ja-Antworten).
- StageBoard **erst am Ende** zeigen, sonst bewerten sie die Demo statt ihr Problem zu beschreiben.
- Zahlen und Geschichten notieren (Ausfälle, Kosten, Stunden), nicht nur Stimmungen.

**A. Die Band (2 Min)**
1. Besetzung, wie viele Gigs im Jahr, welche Art (Cover, Events, Gottesdienst, eigene Songs)?
2. Wer kümmert sich bei euch um die Technik? Gibt es einen Techniker oder macht das ein Bandmitglied nebenbei?

**B. Heutiges Setup (8 Min)**
3. Womit spielt ihr Tracks und Klick? Auf welchem Gerät, mit welcher Software, welchem Interface?
4. Wer hört was über In-Ears? Wie kommt der Klick zum Drummer, die Tracks zu FOH?
5. Welche Geräte schaltet ihr während eines Songs um (Amp-Presets, Keyboard-Sounds, Licht, Folien)? Automatisch oder per Fuß/Hand?
6. Wie kommen Texte, Akkorde und Setlist zu den Musikern? Auf wie vielen Geräten?
7. Was kostet euch das heute im Jahr (Software, Abos, Tracks)? Was hat die Hardware gekostet?

**C. Schmerzpunkte (10 Min)**
8. Erzählt vom letzten Gig, bei dem technisch etwas schiefging. Was genau, was habt ihr gemacht, wie lange hat es gedauert?
9. Was passiert bei euch, wenn das Abspielgerät (Laptop/iPad) mitten in der Show abstürzt? Habt ihr ein Backup? Ist das schon passiert?
10. Wie viele Kabel laufen auf der Bühne nur für MIDI/Klick/Tracks? Was nervt am Aufbau?
11. Wie lange dauert es, einen neuen Song showfertig zu machen (Tracks, Klick, Cues, Text)? Wer macht das, und können andere aus der Band daran etwas ändern?
12. Gibt es etwas, das ihr gern hättet, aber mit eurem Setup nicht hinbekommt? (Nicht vorsagen; zuhören, ob „synchron auf mehreren Geräten“, „ohne Techniker“ oder „ausfallsicher“ von selbst kommt.)
13. Habt ihr schon etwas versucht, um das zu lösen? Warum aufgegeben oder gewechselt?

**D. Erst jetzt StageBoard (5-8 Min)**
14. Kurze Demo: zwei Tablets, Play am einen, Klick und Track im Takt am anderen; ein Tablet ausschalten, die Show läuft weiter; Kemper-Wechsel vom Gitarren-Tablet.
15. Was davon würde euch bei eurem letzten Problem (Frage 8) helfen - konkret?
16. Was müsste es können, damit ihr euer heutiges Setup dafür ersetzt? Was dürfte auf keinen Fall fehlen (iOS? Englisch? Stems? Termine?)
17. Wer bei euch würde das entscheiden und bezahlen?

**E. Preis und nächster Schritt (3 Min)**
18. Was zahlt ihr heute insgesamt für eure Bühnen-Software? Wäre StageBoard zusätzlich oder statt etwas?
19. Was wäre für euch eher denkbar: einmalig für den Server (~99-149 €), monatlich (~6-8 €), oder eine fertige Box? Was wäre zu viel?
20. Würdet ihr es bei einer Probe mit uns ausprobieren? (Ein konkretes Datum ist das beste Signal; ein „vielleicht später“ ist ein Nein.)

**Auswertung nach 5-10 Gesprächen:**
- Wie oft kamen Ausfall, Kabel, „nur einer kann das Rig bedienen“ oder Timing zwischen Geräten **von selbst** (Frage 8-13)?
- Wie viele haben einen Probetermin zugesagt (Frage 20)?
- Welche Muss-Funktionen wurden mehrfach genannt (Frage 16) - deckt sich das mit docs/20 §8 oder fehlt etwas Grundsätzliches (z. B. iOS)?
- Faustregel: Wenn weniger als ein Drittel das Kernproblem von selbst nennt und kaum jemand einen Probetermin will, ist die Nische zu klein für ein Produkt - dann StageBoard als eigenes Werkzeug oder Open Source weiterführen (§2 A1).

**Wo Bands finden:** eigene Kontakte und Bands auf denselben Bühnen, Kirchengemeinden mit Lobpreis-Teams, Foren (BandHelper-Forum, Gearspace „Live Sound“/Playback, r/livesound, r/WorshipLeaders), Facebook-Gruppen für Cover- und Hochzeitsbands, Musikschulen und Proberaum-Zentren.

## Quellen

- [BandHelper: Pricing](https://www.bandhelper.com/main/pricing_upcoming.html)
- [BandHelper: Live Sharing](https://www.bandhelper.com/tutorials/live_sharing.html)
- [BandHelper im App Store](https://apps.apple.com/us/app/bandhelper/id552012927)
- [BandHelper: MIDI oder OSC senden](https://www.bandhelper.com/tutorials/sending_MIDI.html)
- [AbleSet](https://ableset.com/) und [AbleNet](https://ableset.com/docs/ablenet/)
- [MultiTracks: Playback-Abos](https://intercom.help/multitracks/en/articles/8106819-playback-subscriptions-explained)
- Weitere Quellen zu BandHelper, Ableton und Prime: docs/20
- [Strofa](https://www.strofa.no/)
- [StageTracker Pro](https://backstageapps.com/stagetracker)
- [Show Buddy Setlist](https://www.dmxis.com/show-buddy-setlist/)
- [Show Buddy Active](https://www.dmxis.com/show-buddy-active/)
- [Prime MultiTrack App](https://loopcommunity.com/prime-multitrack-app)
- [Best Setlist Apps for Gigging Musicians (2026), Band Central](https://www.bandcentral.com/blog/best-setlist-apps-for-gigging-musicians)
- [The 5 Best Setlist Apps (2026), SetBook](https://www.set-book.com/blog/best-setlist-apps-for-gigging-musicians)
- [Set List Maker bei Google Play](https://play.google.com/store/apps/details?id=com.arlomedia.setlistmaker&hl=en_US)
- [Livetraker](https://livetraker.com/)
- [qPlayer im App Store](https://apps.apple.com/gb/app/qplayer/id6758870264)
- [Playback Rigs Demystified](https://themididrummer.wordpress.com/2020/02/28/playback-rigs-demystified/)
- [How to build an all-in-one rack for your band, Gear Gods](https://geargods.net/features/how-to-build-an-all-in-one-rack-for-your-band/)
