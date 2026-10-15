# Stems: Stem-Satz, Üben, Gig und Timeline

Konzept, Stand 2026-10-15, mit Marco besprochen. Baut auf der Stem-Trennung auf dem Stage-Server auf (Plugin „Spuren trennen“, #9, PR #522, Installation in docs/03 §0b4) und bündelt #482 (mehrere Spuren je Song, Mixer, Stummschalt-Vorlagen je Show). Gebaut sind die Trennung und der Stem-Satz (§7 Schritt 1).

## 1. Ausgangslage

- **Trennung gebaut (#522):** Ein Track einer Variante wird auf dem Stage-Server mit Demucs in Spuren zerlegt – Standard (Schlagzeug, Bass, Gesang, Rest) oder Erweitert (+ Gitarre, Keys/Piano), wahlweise Gitarre nach Stereoseite links/rechts. Die Spuren sind Tracks `kind: 'stem'` mit `parentTrackId`, WebM/Opus 256 kbit/s (anfangs MP3 – Höhen der Summe verloren, 25 ms Versatz), liegen nur auf dem Server, sind nie Backing-Track, lassen sich anhören, umbenennen, entfernen.
- **Qualität:** Marco nach dem ersten Hören (All the small things): „really, really good“.
- **Zwei Quellen für Spuren:**
  1. **Getrennt** aus einem fertig gemischten Song (Demucs).
  2. **Vom Bandleader geliefert** als Einzeldateien. Ohne feste Struktur: meist Keys, etwas Gesang, Gitarren, Bass, manchmal ein Sonderinstrument – Anzahl und Belegung wechseln von Song zu Song (Marco).

## 2. Modell: der Stem-Satz

Ein **Stem-Satz** ist eine Gruppe von Spuren, die zusammen gespielt den Song ergeben, alle ab 0:00 gleich lang ausgerichtet.

- **Getrennt:** Der Satz hängt am Track, aus dem er entstand (heute schon so: `parentTrackId`).
- **Hochgeladen:** Mehrere Dateien auf einmal in einen Satz, auch ganz ohne Mix-Track (`parentTrackId: null`). Entschieden beim Bau (2026-10-15): **keine eigene Satz-Kennung** – eine Variante ist ein Arrangement und hat höchstens einen hochgeladenen Satz; eine neue Lieferung ersetzt Spuren einzeln. Stems, deren Track entfernt wurde, zählen zum hochgeladenen Satz, damit nie eine Spur unsichtbar wird. Name und Rolle kommen aus dem Dateinamen („03_Hammond.wav“ → „Hammond“, Keys).
- **Name je Spur frei** („Gitarre Marco“, „Hammond“, „Chor hoch“).
- **Rolle je Spur optional:** Schlagzeug, Bass, Gitarre, Keys, Gesang, Chor, Klick, Sonstiges. Bei der Trennung automatisch gesetzt, bei hochgeladenen Spuren vorgeschlagen (aus dem Dateinamen) und änderbar, darf leer bleiben – die Bandleader-Spuren haben keine feste Struktur. Rollen sind ein Hilfsmittel für songübergreifende Vorlagen (§4), keine Pflicht.
- **Ein Song spielt entweder** den Mix-Track (wie heute) **oder** seinen Stem-Satz, live auf dem Gerät gemischt.

**Verworfen:** ein Knopf „Ohne mich“ (Rolle des eigenen Profils stumm). Marco: geht nicht immer, und wer bei einem Gig nicht dabei ist, kann nicht „ohne mich“ sagen – stummgeschaltet wird, was fehlt, nicht wer bedient.

## 3. Solo üben – der größte Nutzen, zuerst

- **Widget „Stems“:** je Spur ein Regler mit **Stumm** und **Solo**, groß genug für die Bühne (docs/15). Typisch: Gitarre stumm, selbst dazu spielen.
- Einstellung je Song auf dem Gerät gemerkt.
- Zusammen mit dem Loop-Trainer (75/50 %) und der Timeline-Geschwindigkeit ein vollwertiges Übungswerkzeug.
- Spielt über die Web-Audio-Engine (docs/19) auf der Klick-Uhr; der Regler „Track“ aus „Mein Mix“ (docs/21 §9.3) gilt für die Summe der Spuren.

## 4. Gig – die Besetzung entscheidet

- **Vorlage je Show:** „heute ohne Bass“ – nach Rolle für alle Songs, wo Rollen gesetzt sind, sonst je Song die einzelne Spur. Setzen mit Master-Token.
- **Gemischt** wird live auf dem Gerät, das den Track spielt; die Balance zwischen den Spuren ist Teil des Songs (vom Bandleader oder selbst eingestellt), die Vorlage schaltet nur stumm.
- **Später (docs/21 §9.2, #481):** Spuren auf eigene Kanäle eines Audio-Interfaces, damit FOH sie mischt.
- **Rückfall:** Ist ein Gerät zu schwach (Fire) oder sind die Spuren nicht geladen, spielt es den Mix-Track – oder der Server rechnet vor dem Gig eine Mischung „ohne Bass“ für diese Show (dann reicht wieder eine Datei).

## 5. Timeline – ruhig, Details auf Wunsch

- Die Wellenform-Spur zeigt wie heute den **Mix**, mit ▸ zum **Aufklappen**: darunter je Spur eine schmale Wellenform; zugeklappt bleibt alles wie heute.
- **Antippen einer Spur-Wellenform = nur diese Spur hören** (Solo) – zum Setzen von Cues, Taktstrichen oder Zeilen, z. B. nur Schlagzeug.
- **Quelle der Analyse** (Beat-Tracker, rot/grün, „Track analysieren“): Mix oder Schlagzeug-Spur, wählbar. Erster Versuch mit der Schlagzeug-Spur war schlechter als der Mix (Hi-Hats und Achtel machen jedes Raster „grün“, der Tracker driftete bis Takt 89 um 0,34 s gegen den per Ohr geprüften Punkt, 2026-10-15); deshalb Wahl, nicht Standard, bis eine Schlag-genaue Erkennung (Kick auf 1, Snare auf 2/4) mit Ohr-geprüften Stellen belegt ist.

## 6. Technik und Risiken

- **Wiedergabe:** 4–7 Spuren gleichzeitig dekodiert, alle auf derselben Audio-Uhr. CPU und Speicher **zuerst messen** – Xiaomi und vor allem Fire (#457) –, bevor es in den Gig geht.
- **Speicher:** Spuren nur auf Geräte laden, die sie nutzen (Übungsgerät, spielendes Gerät); ~4 MB je Spur und Song.
- **Ausrichtung:** Hochgeladene Spuren müssen gleich lang ab 0:00 sein; beim Hochladen prüfen und abweichende Längen melden.
- **Rechte:** wie bisher private Übungsspuren der Band (docs/16).

## 7. Reihenfolge

1. **Stem-Satz:** Modell, Rollen, Hochladen mehrerer Spuren, Anzeige im Audio-Tab. **Gebaut** (2026-10-15): Rolle `role` am Track (`StemRoleSchema`), Trennung setzt sie, „Spur bearbeiten“ (Name + Rolle), Warnung bei Längen über 1 s Unterschied.
2. **Solo üben:** Widget „Stems“, Live-Mischung auf dem Gerät, Messung auf Xiaomi und Fire.
3. **Timeline:** aufklappbare Spur-Wellenformen, Solo-Hören, Analyse-Quelle wählbar.
4. **Gig:** Show-Vorlagen, Rückfall auf den Mix, später getrennte Ausgänge.

## Verwandt

#9 (Trennung), #482 (Stems im Gig), #457 (Fire-Leistung), #481 (getrennte Ausgänge), docs/03 §0b4, docs/14 (Timeline), docs/19 (Web-Audio-Wiedergabe), docs/21 §9.2/§9.3 (Ausgänge, Mein Mix).
