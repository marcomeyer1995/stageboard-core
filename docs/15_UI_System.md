# 15 · UI-System: Harmonisierung aller Bedienelemente

Stand 2026-10-08 - **gebaut und gemergt** (#425, 2026-10-07; Konzept #424, Sammel-Issue #423 geschlossen). Das Dokument beschreibt die geltenden Regeln; der Wächter-Test `components/ui/guard.test.ts` setzt sie durch (§7 Phase 5). Bestandsaufnahme mit Screenshots und allen Varianten: Analyse-Seite „StageBoard Interface Inventory“ (Artifact, privat bei Marco). Umsetzung: Sammel-Issue #423.

## 1. Warum

Jeder Bildschirm wurde zu einer anderen Zeit gebaut und hat Höhe, Ecke und Farbe selbst gewählt. Gezählt auf `main` 5b57496 (106 Dateien, 1589 gestylte Elemente):

- 310 Buttons in 7 Aufgaben mit 9 Höhen und zwei Ecken, gemischt;
- 51 Auswahl-Buttons in vier Formen (56 px „Ansicht“, 48 px „Modus“, Pillen bei „Speicher & Sync“ und den Bibliotheks-Filtern, die Spur-Umschaltung im Song-Editor) plus 7 native Checkboxen;
- vier Signale für „ausgewählt“ (gelbe Füllung, getönte Karte, „● Aktiv“, Symbol);
- 21 Dialoge in 9 Breiten, „Schließen“ und Aktionen an verschiedenen Stellen, drei Menü-Umsetzungen, 7 freie z-Index-Werte;
- Eingabefelder und Dropdowns ohne feste Höhe vor allem in Widget-Einstellungen und im Cue-Editor.

Die Theme-Grundlage existiert schon (`src/index.css`): je Theme drei Ecken (`--sb-radius-sm`, `--sb-radius`, `--sb-radius-pill`), Farben, `--sb-touch` 56 px, `--sb-touch-primary` 72 px, `--sb-text-min` 16 px. Das Problem: Es gibt keine Regel, welches Element welches Token nimmt.

## 2. Grundprinzip: Rolle vs. Wert

- **Die Harmonisierung legt die Rolle fest:** „Jede Auswahl-eins nimmt die *Bedienelement-Ecke*, die *Auswahlfarbe*, die *Formular-Höhe*.“ In jedem Theme gleich - ein Musiker findet alles an derselben Stelle in derselben Form.
- **Das Theme legt den Wert fest:** wie groß die Bedienelement-Ecke ist (0 px Stage-Console/High-Contrast, 4 px Default, 14 px Soft-Cards), welche Farbe die Auswahl hat, welche Schrift, wie stark Schatten.

Themes bleiben also und unterscheiden sich danach *sauberer*: Eine Theme-Einstellung ändert jedes Element dieser Art auf einmal.

## 3. Entscheidungen (2026-10-07)

| | Entscheidung | Art |
|---|---|---|
| D1 Ecken | Bedienelemente (Buttons, Leisten, Chips, Felder) = kleine Ecke; Karten und Dialoge = normale Ecke; Pille nur für Badges | Theme-Wert |
| D2 Größen | *(ersetzt durch D10)* Bühne (Dashboards, Burger-Menü) 56 px · Formulare (Einstellungen, Editoren, Dialoge) 48 px · Show-Aktionen (Play, Weiter, Ready) 72 px. Themes dürfen größer, nie kleiner. **Handy (2026-10-16, Marco):** Bühnen-Bedienelemente in kleinen Widgets dürfen dort bis 48 px schrumpfen (Formularhöhe), nie darunter | Regel: Minimum · Theme: darüber |
| D3 Grau | Sekundäre Buttons im helleren Grau (`control-strong`) - hebt sich von Karten und nicht gewählten Segmenten ab | Theme-Wert |
| D4 Aktiv | „Aktiv / das bist du“ = gelbe Umrandung + Badge „Du“ / „Aktiv“; gelbe Füllung bleibt für einen gewählten Wert reserviert | Regel |
| D5 An/Aus | Echter Schalter (Knopf auf Schiene) | Regel |
| D6 Dialoge | Der Ausweg ist immer an derselben Stelle: die feste Zeile unten (scrollt nie weg, liegt unter dem Daumen). Mit etwas zu bestätigen: „Abbrechen“ links, Hauptaktion rechts. Ohne Bestätigung (wirkt sofort: Einstellungen, Tonart): ein „Fertig“ rechts; ⋯-Menüs: „Abbrechen“. Die Titelzeile nennt nur den Dialog. Daneben tippen und Zurück-Geste schließen ebenfalls (präzisiert 2026-10-07: nie zwei Auswege, nie mal oben, mal unten) | Regel |
| D7 Eins vs. mehrere | Eins = zusammenhängende Leiste, gewähltes Segment gefüllt; mehrere = einzelne Chips mit Kästchen vorn (leer + Umriss = nicht gewählt, angehakt + gefüllt = gewählt; das Kästchen ist immer da, damit die Breite nie springt - präzisiert 2026-10-07) | Regel |
| Tabs | Seiten-Navigation (System-Tabs, Editor-Tabs) = Text mit gelber Unterstreichung. „Ansicht“ im Burger-Menü ist eine zusammenhängende Leiste wie „Modus“ (präzisiert 2026-10-07: getrennte Buttons über einer Leiste wirkten wie zwei Systeme) | Regel |
| Themes | Wie Dashboards: in der Band gespeichert, bandweit oder privat, Admins schützen Vorlagen, andere duplizieren; jedes Gerät wählt sein Theme. Theme-Editor = eigenes Projekt danach | - |

### Navigation, Menüs und Größen-Stufen (2026-10-16, Marco)

| | Entscheidung | Art |
|---|---|---|
| D8 Ecken oben | **Links oben = wohin, rechts oben = was kann ich hier tun.** ☰ steht auf jeder Ansicht links oben (Dashboards, Bibliothek, System, Editoren) - nur nicht in den Onboarding-Schritten (Beitreten, Mitglieder, Profil wählen), die jeweils den ganzen Bildschirm füllen und deren Menü noch nichts Brauchbares hätte. Es öffnet eine **Schublade, die von links hereingleitet** (kein Dialog mehr): Boards / Bibliothek / System, Modus, Vollbild, Band und Profil. Auf Dashboards öffnet nur ein Tipp auf ☰, kein Wisch vom Rand (sonst geht sie mitten im Song aus Versehen auf); daneben tippen schließt (D6). Rechts oben steht auf Dashboards das **Bento-Menü** (neun Punkte): Dashboard wählen, Bearbeiten (Edit-Modus), Dashboards anlegen, ordnen, ausblenden. Die Dashboard-Liste verschwindet aus ☰. Auf den anderen Ansichten steht rechts oben das ⋮ der Seite (D9). **Nie aussperren:** Blendet ein Dashboard die Statusleiste aus, bleiben ☰ und Bento als kleine Eckknöpfe in den beiden oberen Ecken (ersetzt den schwebenden Menüknopf unten rechts) | Regel |
| D9 ⋯ vs. ⋮ | **⋯ (waagerecht, „Meatballs“)** = Optionen für **einen Eintrag** unter gleichartigen: Widget, Song-, Setlist-, Mitglieder-, Plugin-, Hardware-Zeile. **⋮ (senkrecht, „Kebab“)** = Optionen für **die ganze Seite**, immer rechts oben in ihrer Kopfzeile: Song-Editor (Export, Löschen), Setlist-Detail, Dashboard-Einstellungen in der Edit-Leiste, ein System-Tab. Beide öffnen dasselbe `ActionMenuDialog`; der Wächter-Test prüft, dass ⋮ nur in Seitenköpfen vorkommt | Regel |
| D10 Größen-Stufen | Ersetzt D2. Die Stufe kommt aus dem **Ort**, nicht aus dem Widget-Typ - siehe Tabelle unten; auf Dashboards stellt man ein einzelnes Widget sichtbar auf „Kompakt“ (2026-10-17). Was auf der Bühne benutzt werden kann, ist fett; was nur der Vorbereitung dient, darf kleiner sein, damit mehr auf den Bildschirm passt, ohne zu quetschen | Regel: Minimum · Theme: darüber |
| D11 Speichern auf Seiten | Ganze Seiten mit Entwurf (Song-Editor, Setlist bearbeiten) speichern **oben rechts in der Kopfzeile** (neben ⋮), nie am Ende der Seite: die Kopfzeile scrollt nicht weg, auch nicht über der Tastatur. Der Ausweg ist ← / Zurück-Geste; mit ungespeicherten Änderungen fragt `lib/unsavedChanges`. Ein eigenes „Abbrechen“ daneben nur, wo die Seite ein Bearbeiten-Modus einer Ansicht ist (Setlist). **Dialoge** behalten D6 (feste Zeile unten) - Seite oben, Dialog unten (Marco, 2026-10-19, #603) | Regel |
| D12 Seitenkopf | **Jede Seite hat denselben Kopf** (`components/ui/PageHeader`, Marco 2026-10-30): Zeile 1 = gleich große quadratische Knöpfe - **← links** (nur wo die Liste nicht daneben steht), dazwischen höchstens die Ansichten der Seite (Song-Editor), **rechts die Aktionen, die Hauptaktion zuerst, ⋮ immer ganz rechts** (D9). Aktionen auf dem Handy nur als Symbol (Name als Beschriftung für Vorlesen/Langdruck), ab 600 px Symbol + Wort. Zeile 2 = **der Titel ganz, nie abgeschnitten** (bricht um), daneben ein Badge (z. B. „Aktiv“); Zeile 3 = **eine graue Zeile** mit den Eckdaten (Datum · Anzahl · Interpret · Tonart …) statt einer Reihe Chips. Gleiche Stelle, gleiche Größe auf jeder Seite - das Muskelgedächtnis gilt überall. Gebaut für Setlist (Vorschau + Bearbeiten), Song-Vorschau, Song-Editor, Nachbericht einer Show | Regel |
| D12 Erklärungen hinter ⓘ | Erklärungen, Anleitungen und Hintergrund (Kartenbeschreibung, Seiten-Einleitung, „wozu ist das“) stehen nicht dauerhaft unter einer Einstellung, sondern hinter einem kleinen grauen **ⓘ** neben Überschrift oder Beschriftung (`InfoHint`; `info=` an `Field`/`Select`/`Segmented`/`Section`/`Switch`). Antippen öffnet eine **Sprechblase** über dem Inhalt - nichts verschiebt sich; Antippen daneben, Esc, Scrollen oder ⓘ schließt sie. **Sichtbar bleiben:** Warnungen und Fehler, Folgen („gilt für alle“, „Nur der Band-Admin kann …“), Live-Status („4 MB von … genutzt“, „Synchronisiert“), leere Zustände („Noch kein Ziel eingerichtet“) - dafür bleiben `hint=` und `description=`, kurz (der Wächter-Test lehnt über 80 Zeichen ab) (Marco, 2026-10-21, #625; gegen „Aufklappen an Ort und Stelle“ in einer Demo verglichen) | Regel |

| Stufe | Wo | Sichtbar | Trefferfläche | Text |
|---|---|---|---|---|
| **Bühne** | Dashboards (jedes Widget, solange „Kompakt“ aus ist), Statusleiste, ☰ und Bento, Schublade | 56 px, Show-Aktionen (Play, Weiter, Ready) 72 px; Handy in kleinen Widgets bis 48 px (D2-Ausnahme bleibt) | = sichtbar, keine unsichtbare Verlängerung | mind. 16 px |
| **Kompakt** | ein Widget, bei dem im ⋯-Menü „Kompakt“ eingeschaltet ist | 48 px | 48 px | mind. 16 px |
| **Vorbereitung** | Bibliothek, Song-Editor, Timeline-Werkzeuge, System, Dialoge, Assistenten | 40 px | 48 px (unsichtbar erweitert, mind. 8 px Abstand zwischen Trefferflächen) | 16 px; Nebenzeilen (Datum, Beschreibung, Hinweis) 14 px - **Versuch**, Marco prüft auf dem Dev-Build |

Begründung: Apple verlangt mindestens 44 × 44 pt Trefferfläche, Google Material 48 × 48 dp mit 8 dp Abstand (das Sichtbare darf kleiner sein, z. B. ein 24-dp-Symbol), WCAG 2.2 24 px (AA) bzw. 44 px (AAA). 48 ist damit überall das Minimum einer Trefferfläche. Auf der Bühne liegen wir bewusst darüber (nasse Finger, Dunkelheit, ein Blick aus einem Meter, Tablet schräg am Ständer), und dort ist die Trefferfläche genau das, was man sieht - eine unsichtbar größere Fläche überrascht unter Stress. Kompakt wählt man **je Widget sichtbar im ⋯-Menü** (Marco, 2026-10-17). Zuerst hing die Stufe automatisch an „Anbieten in“ (nur Solo Üben = 48 px) - verworfen: eine Größe, die sich als Nebenwirkung einer anderen Einstellung ändert, versteht niemand.

## 4. Welches Element wann

Testfrage: **Kann eine gemeinsame Frage über den Elementen stehen, und die Auswahl ist ihre Antwort?** Ja → Leiste oder Chips. Nein, jedes Element braucht seinen eigenen Satz → Schalter.

| Aufgabe | Frage | Element | Beispiele |
|---|---|---|---|
| Genau eins wählen | „Welches?“ | Leiste (`Segmented`) | Modus, Sichtbar für, Banner/Vollbild/Aus, Bibliotheks-Filter |
| Mehrere wählen | „Welche?“ (gleichartig) | Chips mit Kästchen (`ToggleChip`) | Empfänger im Stage-Messenger, Anbieten in Gig/Solo, Akkordarten |
| Eine Einstellung an/aus | „Ist X an?“ | Schalter (`Switch`) | Einrasten, Klick, Statusleiste, Vorlage, „Songs gleich hinzufügen“ |
| Seite wechseln | „Wohin?“ | Tabs (`Tabs`) | System → Band / Plugins / …, Song-Editor Text / Timeline |
| Etwas tun | - | Button | Speichern, Anlegen, Takt 1 hier |

Verhalten passt zur Form: das gewählte Segment erneut tippen ändert nichts; einen gewählten Chip erneut tippen nimmt ihn heraus. Gruppen, die nie leer sein dürfen (Anbieten in), verhindern das Abwählen des letzten mit Begründung. „Alle“ bei den Empfängern bleibt ein eigener erster Chip, der die anderen leert. Unter Mehrfach-Gruppen steht kurz „Mehrere möglich“.

Alle drei Auswahl-Elemente teilen Höhe, Ecke, Gelb für „an/gewählt“ und Schrift; nur ein Signal unterscheidet sie (zusammenhängend, Kästchen, Knopf).

Bibliothek: kein Filter „Alle / Setlists / Songs“ mehr - seit #430 zwei Tabs „Setlists (n)“ / „Songs (n)“ mit eigener Suche und Sortierleiste (`Segmented`; vorher kurz einklappbare Überschriften, 2026-10-07).

Neuer Eintrag: immer `AddRow` - gestrichelter Umriss, gelbes „+ Text“, am Ende der Liste, zu der er hinzufügt (volle Breite); neben einer Überschrift (Bibliothek) gleiches Aussehen, nur textbreit. Ausnahmen: „+ Widget“ (Hauptaktion der Edit-Leiste) und Einfüge-Werkzeuge im Editor („+ Kommentar“, „+ Tab“). Festgelegt 2026-10-07, abgesichert im Guard-Test.

## 4a. Bildschirmtastatur und sichtbare Fläche (2026-10-28)

Beim Aufgehen der Tastatur meldet die App (WebView auf dem Redmi) für einen Moment eine **falsche, viel zu kleine** sichtbare Höhe (~300 statt ~650 px), erst danach die richtige. Alles, was sich direkt nach dieser Höhe richtet, zeichnet sich dadurch **zweimal**: Dialoge erst klein oben, dann groß; die ChordPro-Tastenleiste springt hoch und wieder runter; die Varianten-Zeile im Song-Editor verschwindet kurz.

**Regel:** Wer sich nach der sichtbaren Fläche oder einer offenen Tastatur richtet, nimmt den **beruhigten** Wert - `useSettledVisualViewport()` / `useSettledTouchKeyboardOpen()` (`lib/useVisualViewport.ts`, `lib/useTouchKeyboardOpen.ts`): erst wenn die Fläche 150 ms still hielt. Nie `useVisualViewport()` direkt in einer Komponente. Abgesichert im Guard-Test.

- Höhen-Schwellen (z. B. „genug Platz für die Varianten-Zeile“) nehmen zusätzlich das **Größere** aus sichtbarer Fläche und Seitenhöhe (`window.innerHeight`) - die Seitenhöhe springt nicht.
- Eine feste Obergrenze „für die Tastatur“ (z. B. Dialog max. 38 %) erst **nach** der Beruhigung entscheiden, sonst wieder zweimal gezeichnet.
- Schon richtig und so lassen: Dashboards halten ihre Höhe beim Tippen (`useKeyboardSteadyHeight`), Widget-Größen sind gedämpft (`useElementSize`), Popover und ⓘ-Blasen schließen bei jeder Größenänderung.

## 5. Tokens (Phase 1)

Neue semantische Tokens in `src/index.css`, in allen fünf Themes definiert, in `tailwind.config.js` verdrahtet:

| Token | Bedeutung | Default |
|---|---|---|
| `--sb-radius-control` | Ecke aller Bedienelemente | = `--sb-radius-sm` |
| `--sb-radius-container` | Ecke von Karten, Dialogen, Menüs | = `--sb-radius` |
| `--sb-h-show` | Show-Aktionen | 72 px (= `--sb-touch-primary`) |
| `--sb-h-stage` | Bühnen-Bedienelemente | 56 px (= `--sb-touch`) |
| `--sb-h-form` | Formular-Bedienelemente | 48 px |
| Ebenen | feste z-Stufen als Tailwind-Klassen `z-content` 10 · `z-bars` 20 · `z-menu` 40 · `z-dialog` 50 · `z-alert` 55 · `z-flash` 58 · `z-takeover` 60 (`tailwind.config.js`, kein CSS-Token) | ersetzt die freien z-Werte |

**Bedeutungsfarben (2026-10-08):** Fehler, Warnung, OK und Info, die Zustände der Statusleiste, die Blitzmeldung, die Abdunklung hinter Dialogen und die Vollbild-Alarme kommen ebenfalls aus Tokens. Vorher standen sie als Tailwind-Palette (`text-red-500`, `bg-amber-500` …) in 52 Dateien, und kein Theme konnte sie ändern.

| Token (je mit `-ink` für Text darauf) | Tailwind | Wofür | Default |
|---|---|---|---|
| `--sb-danger` | `text-danger`, `bg-danger` … | Fehler, Gefahr, Löschen | red-500 (hell: red-600) |
| `--sb-warn` | `warn` | Warnung, „noch nicht“ | amber-500 (hell: amber-700) |
| `--sb-ok` | `ok` | läuft, verbunden | green-500 (hell: green-700) |
| `--sb-info` | `info` | synchronisiert gerade | blue-500 |
| `--sb-state-{count-in,playing,paused,finished,fault}` | `bg-state-playing` … | volle Statusleiste | blue-700 · green-700 · amber-500 · fuchsia-700 · red-600 |
| `--sb-flash` | `flash` | Stage-Messenger-Meldung | yellow-300 |
| `--sb-scrim` | `bg-scrim/60` | Abdunklung hinter Dialogen | schwarz |
| `--sb-alarm` | `alarm` | Vollbild-Alarm (Audio blockiert, Gerät blockiert) | red-900 |

Ebenso liest das Timeline-Canvas seine Qualitätsfarben aus diesen Tokens. Ausnahmen sind Inhaltsfarben, die ein Musiker wählt oder die Kategorien unterscheiden (`widgets/widgetColors.ts`, Cue- und Notizfarben der Timeline), die Stimmgerät-Skala und das Druckblatt (immer schwarz auf weiß). Der Wächter-Test verbietet Palettenfarben und rohe z-Werte.

Höhen und Ecken gibt es als Tailwind-Klassen `h-show` / `h-stage` / `h-form` (auch `min-h-*`) und `rounded-control` / `rounded-container`. Bestehende Tokens bleiben; die neuen sind Aliasse, damit ein späterer Theme-Editor Rolle für Rolle einstellen kann.

## 6. Komponenten (Phase 2)

In `packages/stage-pwa/src/components/ui/`, jede mit Tests und passenden ARIA-Attributen:

| Gruppe | Komponente | Ersetzt (ca. Stellen) |
|---|---|---|
| Aktionen | `Button` (Hauptaktion · sekundär · Gefahr · leise; Größe show · stage · form) | handgeschriebene Buttons, 10 lokale Stil-Konstanten (~245) |
| | `IconButton` (Trefferfläche nie unter 48 px, D10) | ⋯, ×, ↑↓, Stepper (~25) |
| Auswahl | `Segmented` | Ansicht, Modus, Sync, Blitzmeldungen, Editor-Umschalter (~20) |
| | `ToggleChip` | Gig/Solo, Empfänger, Akkordarten, Timeline-Schalter (~25) |
| | `Switch` (`role="switch"`) | native Checkboxen, „Einrasten“ (~10) |
| | `Tabs` (`role="tablist"`) | System-Tabs, Editor-Tabs (~4) |
| | `CheckRow` / `CheckBox` (gebaut dazugekommen) | Mehrfachauswahl als Listenzeile mit Kästchen |
| Eingaben | `Field` · `TextArea` · `Select` · `Slider` | Textfelder, Dropdowns, Regler (~100) |
| Struktur | `Card` · `ListRow` (56 px) · `Section` | Panels, Song-/Setlist-/Mitglieder-/Dashboard-Zeilen, Großbuchstaben-Überschriften (~125) |
| Overlays | `Dialog` (S 384 · M 448 · L 768 px) · `ActionMenu` / `ActionMenuDialog` (+ `MENU_ROW`) | 21 Dialoge; OverflowMenu, RowActionsMenu, Widget-Menü |
| Signale | `Badge` · `StatusDot` · `ActiveMarker` | Rollen-Tags, Stufen-Chips, „Aktiv“, „zu klein“, Status-Punkte, getönte Karten (~38) |

| Neu anlegen | `AddRow` (gebaut dazugekommen, §4) | eigene „+ Neu“-Buttons |

Gruppen-Hilfen: `ChipGroup` (Überschrift + Hinweis „Mehrere möglich“ über `ToggleChip`s). Alle Exporte in `components/ui/index.ts`.

Rot nur für Fehler und Gefahr (wie in der Statusleiste festgelegt).

## 7. Ablauf

0. **Konzept** - dieses Dokument, Sammel-Issue #423.
1. **Tokens** (½ Tag, nichts sichtbar).
2. **Komponenten** (1½-2 Tage).
3. **Vorschau-Seite** (½ Tag): versteckte Seite mit jeder Komponente in jedem Zustand, umschaltbar zwischen den fünf Themes, auf Tablet und Handy. **Freigabe durch Marco, bevor umgestellt wird.** (Freigegeben und nach der Umstellung wieder entfernt, 2026-10-07 - im Git-Verlauf erhalten.)
4. **Umstellung** (4-6 Abende, ein Branch, Bühne zuerst): Burger-Menü, Status- und Edit-Leiste, Dashboard-Einstellungen · die 27 Widgets und ihre Einstellungen · Bibliothek, Setlists, Song-Vorschau · System (Einstellungen, Band, Hardware, Geräte, Diagnose) · Song-Editor, Timeline, Cue-Dialog und -Recorder · alle Dialoge, Assistenten, Beitreten und Onboarding · Aufräumen (drei Menüs → `ActionMenu`, Checkboxen → `Switch`/`ToggleChip`).
5. **Wächter** (½ Tag): `components/ui/guard.test.ts` durchsucht alle Quellen und schlägt fehl bei: alten Ecken `rounded-sb`/`rounded-sb-sm`; nacktem `hover:` (nur `[@media(hover:hover)]:hover:`, sonst bleibt es auf Touch nach dem Tippen hängen); nativen Checkboxen und Radio-Buttons; Buttons in der zweiten Akzentfarbe; Bedienelementen mit `h-7` bis `h-11`; eigenen „+ Neu“-Buttons statt `AddRow`; runden Pillen als Auswahl; wachsenden Textfeldern (`flex-1`) ohne `min-w-0`; einem übrig gebliebenen „Schließen“ in Dialogen.
6. **Prüfung und Freigabe** (1 Abend): alle Tests; Screenshots aller Bildschirme in einem eckigen, einem weichen und dem Default-Theme auf Fire, Xiaomi und Handy; Marco prüft das **fertige Ergebnis** auf einem Test-Build (Freigabe am Stück); dann Merge und Deploy.

**Risiken:** sehr große Änderung - offene PRs (#399, #405) vorher mergen oder parken. Bühnen-Widgets vorher/nachher per Screenshot vergleichen. Viele Tests prüfen Stil-Klassen (`toHaveClass('bg-accent')`) und müssen angepasst werden.

## 8. Danach: eigene Themes (eigenes Projekt)

Theme-Editor auf den Tokens aus Phase 1: Grundton (dunkel/hell), Akzentfarbe (+ optional zweite für Hauptaktionen), Ecken (eckig · weich · rund), Größe (normal · groß), Schrift (3-4 gut lesbare), Kontrast (normal · hoch), Schatten (an · aus). Leitplanken: Kontrast wird live geprüft und ungenügende Kombinationen lassen sich nicht speichern; Touch-Größen nie unter dem Minimum; Rot bleibt Fehlern vorbehalten; die Statusleiste behält ihre Zustandsfarben. Speicherung wie Dashboards (siehe §3); die fünf heutigen Themes werden geschützte Vorlagen.

## 9. Umbau Navigation, Menüs, Größen (ab 2026-10-16)

Reihenfolge, je ein PR, Marco prüft auf dem Dev-Build:

1. **Schublade + Bento** (D8): ☰ als Schublade von links, Dashboard-Liste und „Bearbeiten“ ins Bento rechts oben, Eckknöpfe statt schwebendem Menüknopf; ☰ auf jeder Ansicht prüfen.
2. **⋯ / ⋮** (D9): Seitenmenüs auf ⋮ rechts oben (Edit-Leiste, Song-Editor, Setlist-Detail, System-Tabs), Wächter-Test.
3. **System neu sortiert** nach Geltungsbereich (Analyse 2026-10-16, Bericht: https://claude.ai/artifact/2y3PUooJap2ffXhTdAK1Kz): Dieses Gerät · Ton & Timing · Band · Bühnentechnik (Hardware samt Treibern, Klick und Backing-Track als eingebaute Rollen) · Tablets & Handys · Stage-Server (Verbindung, Sync, aktive Band, Backups, Server-Latenz) · Erweiterungen · Diagnose. Nachbericht wird „Shows“ in der Bibliothek, Geübt/Geprobt wandern in deren Sortierung. Schritt 1 (Aufräumen) ist #533.
4. **Größen-Stufen** (D10): Token `--sb-h-prep` 40 px plus Trefferflächen-Erweiterung, „Kompakt“ je Widget, 14-px-Nebenzeilen in der Vorbereitung. **Teil 1 gebaut (2026-10-16):** `<PrepTier>` (`components/ui/PrepTier.tsx`) um Bibliothek, System, jeden `Dialog` und den Geräte-Assistenten; darin nehmen Button, IconButton, Segmented, ToggleChip, Field/Select und ActionMenu ohne eigene Größe `prep` (40 px, `.sb-hit` verlängert die Trefferfläche unsichtbar auf 48), und `text-sm`/`text-xs` sind 14 px (`--sb-text-secondary`, Klasse `.sb-prep`). Die ☰-Schublade bleibt Bühne (`on={false}`). Band-Tab und Bühnentechnik als schlanke Listenzeilen. **Teil 2 gebaut (2026-10-17):** Schalter „Kompakt“ im ⋯-Menü jedes Widgets (`WidgetInstance.compact`). Die erste Fassung leitete das aus „Anbieten in“ ab und wurde am selben Tag auf Marcos Wunsch ersetzt. `<CompactTier>` (in `WidgetFrame`) setzt dort `--sb-touch`, `--sb-touch-primary`, `--sb-h-stage` und `--sb-h-show` auf 48 px (Klasse `.sb-compact`), und die Widgets mit größenabhängigem Layout (Transport, Klick, Next Song, Tempo, Variante & Track, Dashboard-Umschalter) rechnen über `useTouchSizes()` mit 48 statt 56 / 72. Statusleiste, ☰ und Bento bleiben Bühne. Damit ist Schritt 4 fertig.

