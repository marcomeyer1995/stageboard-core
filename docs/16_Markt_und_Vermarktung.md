# 16 · Markt und Vermarktung

Stand 2026-10-08. Erste Überlegung, kein Beschluss: Gibt es StageBoard schon, und was braucht es, um App und Stage-Server an andere Bands zu verkaufen? Rechtliche Punkte sind eine Struktur zum Weiterklären, keine Rechtsberatung (Steuerberater und IT-/Markenanwalt einbeziehen).

## 1. Marktrecherche: Gibt es das schon?

Kurz: **Teile ja, das Ganze nein.** Mehrere Apps decken einzelne Bereiche ab, einige davon viel. Keine bietet den Kern von StageBoard: einen Band-Server im Proberaum, der alle Geräte offline synchron hält, während jedes Gerät seine eigene Aufgabe erfüllt. Fertig eingerichtet als Box verkauft so etwas niemand.

| Produkt | Was es kann | Sync / Plattform | Preis | Unterschied zu StageBoard |
|---|---|---|---|---|
| **BandHelper** (nächster Konkurrent, „Industriestandard“) | Texte, Akkorde, Setlists, Backing-Tracks, Klick, MIDI, Bühnenlicht, Band-Verwaltung (Termine, Finanzen) | Cloud-Sync; auf der Bühne wird **ein Bildschirm** auf bis zu 15 Geräte gespiegelt, 1–3 s verzögert, die Folgegeräte können selbst nichts tun | Abo; Band mit 2–5 Leuten 40–80 $/Jahr | Kein gemeinsamer Transport, bei dem jedes Gerät eigenständig arbeitet; kein eigener Server; keine In-Ear-Steuerung |
| **Strofa** | ChordPro, Setlists, Backing-Tracks, MIDI, DMX-Licht (Art-Net), Soundcraft-Mischpult, Publikumsbildschirm mit Songwünschen | Cloud; „Live Session“: ein Leiter steuert die Bildschirme der anderen (lokales WLAN nur unter iOS) | 4,99 €/Monat oder 49,99 €/Jahr, keine Gratis-Stufe | Leiter-Folger statt gleichberechtigtem Netz; Android eingeschränkt |
| **StageTracker Pro** | Backing-Tracks (6 Spuren), Klick, Texte, MIDI, Licht | Ein Gerät; kein Band-Sync beschrieben | 3,99 $/Monat | Einzelgerät-App |
| **Show Buddy** (ENTTEC) | Backing-Tracks, Texte, MIDI, DMX-Licht und Video, sehr stark beim Licht | Mac-/Windows-Rechner | Einmalkauf | Show-Rechner, kein Band-Netz |
| **Prime / Playback** (Loop Community / MultiTracks) | Multitracks, Klick, MIDI-Cues | iPad/Mac, ein Abspielgerät | App gratis; Katalog ~30 $/Monat | Lebt vom Verkauf des Track-Katalogs an Kirchen |
| **OnSong, forScore, SongbookPro, Band Central** | Texte, Akkorde, Noten, Setlists | Cloud oder einzelnes Gerät | Abo oder Einmalkauf | Keine Show-Steuerung |
| **qPlayer, Livetraker, Cymatic LP-16** (Hardware-Player) | Cue-Player, MIDI/DMX, Backing-Tracks | Ein Gerät | unterschiedlich | Keine Band-Integration |

### Die Lücke

Soweit recherchierbar, verbindet niemand diese vier Dinge:

1. **Local-first-Server mit Offline-Mesh:** Die Band betreibt ihren eigenen Server, beim Gig braucht es kein Internet.
2. **Eine gemeinsame Show-Uhr:** Jedes Gerät spielt denselben Song zum selben Zeitpunkt (Clock-Sync) statt einen Bildschirm zu spiegeln. Der Drummer sieht den Klick, die Sängerin den Text, der Gitarrist bekommt seine Kemper-Presets, jeder auf seinem eigenen Gerät.
3. **Hardware-Abstraktion:** Cues gehen an „Marcos Kemper“, nicht an einen Port; In-Ear-Mischpult, Fußschalter und Graceful Degradation, wenn ein Gerät fehlt.
4. **Ein frei einrichtbares Dashboard pro Gerät** (die Home-Assistant-Idee).

Dazu die **fertige Box**: Heute bauen Bands ihr Rack selbst zusammen (Playback-Rechner, Interface, Mischpult); niemand verkauft es betriebsbereit.

### Die ehrliche Gegenseite

- Die Konkurrenz ist günstig (40–80 $ pro Band und Jahr) und etabliert.
- Den meisten Bands reichen Texte und eine Setlist. Zielgruppe von StageBoard ist das professionellere Ende: Cover- und Eventbands, Bands mit Backing-Tracks, Kirchenbands.
- Der **Worship-Markt** ist groß und zahlt bereits für solche Werkzeuge, deshalb interessant.

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

## Quellen

- [BandHelper: Pricing](https://www.bandhelper.com/main/pricing_upcoming.html)
- [BandHelper: Live Sharing](https://www.bandhelper.com/tutorials/live_sharing.html)
- [BandHelper im App Store](https://apps.apple.com/us/app/bandhelper/id552012927)
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
