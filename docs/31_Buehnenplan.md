# 31 Bühnenplan – die Bühne als ein Bild (Konzept)

Stand 2026-11-05, Konzept mit Marcos ersten Entscheidungen (§0). Anlass: beim Abgleich nach Gehör (PR #700) war der Weg Geräte → ⋯ → Latenz… → Abgleich zu verschachtelt; Marco: Abgleich gehört in einen späteren Bühnenplan mit sichtbarer Aufstellung, und der kann den Ablauf des Einmessens ändern – darum erst dieses Konzept, dann die automatische Einmess-Runde.

Berührt drei Ideen, die dieselben Daten zeigen: **#62** (räumliche Bühnenmatrix), **#488** (Stage Plot und Input-Liste als PDF) und **docs/21 §4 / docs/30** (Ausgabewege mit Latenz, Hörorte, Abgleich, Einmessen). Dieser Bühnenplan nimmt nur die dritte auf; #62 und #488 bleiben eigene Themen (§0).

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
         ✦ Hörort Saal (FOH)
```

Jeder Weg (Linie) hat einen Zustand: ● eingemessen · ◐ von Hand · ○ fehlt · ✕ instabil.

## 2. Was heute verstreut liegt

| Heute | Was dort steht | Im Bühnenplan |
|---|---|---|
| System → Bühnentechnik | Rollen (Klick, Track, Ansagen …), Logical Devices, Plugins | Rollen hängen an Geräten auf dem Plan |
| System → Tablets & Handys | Geräte, Online-Status, Latenzwerte, Ton-Gesundheit (#703) | Gerätesymbole mit Status; Liste bleibt als Diagnose |
| Latenz… → Nach Gehör abgleichen | Abgleich je Gerät und Weg | am Weg im Plan |
| Rig-Check | Prüflauf mit Test-Song | später „Prüfen“-Ansicht der Karte |
| (#488, #62, nicht gebaut) | Stage Plot/PDF, Rollen-Matrix per Ziehen | bleiben eigene Themen (§0) |

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
Bearbeiten (Wege anlegen, Hörweg wählen) hinter dem Vorhängeschloss: jeder an seinem eigenen Platz, der Admin überall (§0). Später auf denselben Daten die **Karte** (schematisch) mit „Aufbau“ und „Prüfen“ (Ampel je Weg und Gerät – online, Ton sauber (#703), eingemessen); die räumliche Rollen-Matrix (#62) und der Plot (#488) bleiben eigene Themen.

## 5. Einmessen im Plan (verändert den Ablauf)

Heute: ein Gerät wählen → Wert. Im Plan: **ein Weg** (Gerät-Ausgang → Ziel), dessen Nutzer bekannt sind.

- **Startwert:** bekannte Gerätewerte (Plugin-Standard bei Kemper/MIDI); keine Abstände, der Plan ist schematisch (§0).
- **Einmess-Runde:** „Alle fehlenden Wege einmessen“ – das Handy in der Hand, die Wege nacheinander (Referenz gegen Ziel, eigene Tonhöhen, Mikrofon wie PR #700), Wert übernehmen, nachprüfen. Der Plan weiß, welche Wege es gibt und welche fehlen – keine Geräteauswahl von Hand.
- **Wo man steht:** die App sagt es je Weg aus seinen Nutzern („bei Kais In-Ear“, „im Saal“). Ein Weg hat eine Korrektur (§0) – hören ihn mehrere, misst man dort, wo es am meisten zählt (Klick: beim Drummer).
- **Ohne Mikrofon:** von Hand nach Gehör (PR #700) – derselbe Weg, dieselben Werte.
- **Später automatisch:** Pult als Sensor (alle Wege am Pult auf einmal), Kamera für Licht (docs/21 §4).
- **Zustände** je Weg nach den Regeln aus docs/21 §4: zweimal gemessen und gleich → ● eingemessen; weichen ab → ✕ instabil (kein Wert); von Hand → ◐.

## 6. Reihenfolge

1. **Datenmodell + Wege-Liste** im Tab (heute „Bühnentechnik“): Personen mit Hörweg, Hörort „Saal“, Wege (Gerät-Ausgang → Ziel → Hörort) mit Wert und Zustand; „einmessen / abgleichen“ am Weg – ersetzt den verschachtelten Einstieg aus PR #700. Bestehende Latenzprofile werden zu Wegen.
2. **Einmess-Runde** über die Wege eines Hörorts (Mikrofon am Hörort, automatisch, nachprüfen).
3. **Varianten** je Band, im Gig von Hand gewählt.
4. **Karte** (schematisch) mit Aufbau/Prüfen.
5. Pult als Sensor, Licht per Kamera.

## 7. Offen

- (zurzeit nichts – neue Fragen beim Bauen von Schritt 1)
