# 15 · UI-System: Harmonisierung aller Bedienelemente

Stand 2026-10-07 - Konzept, mit Marco abgestimmt, noch nicht gebaut. Bestandsaufnahme mit Screenshots und allen Varianten: Analyse-Seite „StageBoard Interface Inventory“ (Artifact, privat bei Marco). Umsetzung: Sammel-Issue #423.

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
| D2 Größen | Bühne (Dashboards, Burger-Menü) 56 px · Formulare (Einstellungen, Editoren, Dialoge) 48 px · Show-Aktionen (Play, Weiter, Ready) 72 px. Themes dürfen größer, nie kleiner | Regel: Minimum · Theme: darüber |
| D3 Grau | Sekundäre Buttons im helleren Grau (`control-strong`) - hebt sich von Karten und nicht gewählten Segmenten ab | Theme-Wert |
| D4 Aktiv | „Aktiv / das bist du“ = gelbe Umrandung + Badge „Du“ / „Aktiv“; gelbe Füllung bleibt für einen gewählten Wert reserviert | Regel |
| D5 An/Aus | Echter Schalter (Knopf auf Schiene) | Regel |
| D6 Dialoge | Der Ausweg ist immer an derselben Stelle: die feste Zeile unten (scrollt nie weg, liegt unter dem Daumen). Mit etwas zu bestätigen: „Abbrechen“ links, Hauptaktion rechts. Ohne Bestätigung (wirkt sofort: Einstellungen, Tonart): ein „Fertig“ rechts; ⋯-Menüs: „Abbrechen“. Die Titelzeile nennt nur den Dialog. Daneben tippen und Zurück-Geste schließen ebenfalls (präzisiert 2026-10-07: nie zwei Auswege, nie mal oben, mal unten) | Regel |
| D7 Eins vs. mehrere | Eins = zusammenhängende Leiste, gewähltes Segment gefüllt; mehrere = einzelne Chips mit Kästchen vorn (leer + Umriss = nicht gewählt, angehakt + gefüllt = gewählt; das Kästchen ist immer da, damit die Breite nie springt - präzisiert 2026-10-07) | Regel |
| Tabs | Seiten-Navigation (System-Tabs, Editor-Tabs) = Text mit gelber Unterstreichung. „Ansicht“ im Burger-Menü ist eine zusammenhängende Leiste wie „Modus“ (präzisiert 2026-10-07: getrennte Buttons über einer Leiste wirkten wie zwei Systeme) | Regel |
| Themes | Wie Dashboards: in der Band gespeichert, bandweit oder privat, Admins schützen Vorlagen, andere duplizieren; jedes Gerät wählt sein Theme. Theme-Editor = eigenes Projekt danach | - |

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

Bibliothek: kein Filter „Alle / Setlists / Songs“ mehr - die Überschriften „Setlists“ und „Songs“ klappen ihre Liste ein (pro Gerät gemerkt), beim Suchen sind beide immer offen (2026-10-07).

Neuer Eintrag: immer `AddRow` - gestrichelter Umriss, gelbes „+ Text“, am Ende der Liste, zu der er hinzufügt (volle Breite); neben einer Überschrift (Bibliothek) gleiches Aussehen, nur textbreit. Ausnahmen: „+ Widget“ (Hauptaktion der Edit-Leiste) und Einfüge-Werkzeuge im Editor („+ Kommentar“, „+ Tab“). Festgelegt 2026-10-07, abgesichert im Guard-Test.

## 5. Tokens (Phase 1)

Neue semantische Tokens in `src/index.css`, in allen fünf Themes definiert, in `tailwind.config.js` verdrahtet:

| Token | Bedeutung | Default |
|---|---|---|
| `--sb-radius-control` | Ecke aller Bedienelemente | = `--sb-radius-sm` |
| `--sb-radius-container` | Ecke von Karten, Dialogen, Menüs | = `--sb-radius` |
| `--sb-h-show` | Show-Aktionen | 72 px (= `--sb-touch-primary`) |
| `--sb-h-stage` | Bühnen-Bedienelemente | 56 px (= `--sb-touch`) |
| `--sb-h-form` | Formular-Bedienelemente | 48 px |
| `--sb-layer-*` | feste Ebenen: content · bars · menu · dialog · alert · flash | ersetzt die freien z-Werte |

Bestehende Tokens bleiben; die neuen sind Aliasse, damit ein späterer Theme-Editor Rolle für Rolle einstellen kann.

## 6. Komponenten (Phase 2)

In `packages/stage-pwa/src/components/ui/`, jede mit Tests und passenden ARIA-Attributen:

| Gruppe | Komponente | Ersetzt (ca. Stellen) |
|---|---|---|
| Aktionen | `Button` (Hauptaktion · sekundär · Gefahr · leise; Größe show · stage · form) | handgeschriebene Buttons, 10 lokale Stil-Konstanten (~245) |
| | `IconButton` (nie unter 48 px) | ⋯, ×, ↑↓, Stepper (~25) |
| Auswahl | `Segmented` | Ansicht, Modus, Sync, Blitzmeldungen, Editor-Umschalter (~20) |
| | `ToggleChip` | Gig/Solo, Empfänger, Akkordarten, Timeline-Schalter (~25) |
| | `Switch` (`role="switch"`) | native Checkboxen, „Einrasten“ (~10) |
| | `Tabs` (`role="tablist"`) | System-Tabs, Editor-Tabs (~4) |
| Eingaben | `Field` · `Select` · `Slider` | Textfelder, Dropdowns, Regler (~100) |
| Struktur | `Card` · `ListRow` (56 px) · `Section` | Panels, Song-/Setlist-/Mitglieder-/Dashboard-Zeilen, Großbuchstaben-Überschriften (~125) |
| Overlays | `Dialog` (S 384 · M 448 · L 768 px) · `ActionMenu` | 21 Dialoge; OverflowMenu, RowActionsMenu, Widget-Menü |
| Signale | `Badge` · `StatusDot` · `ActiveMarker` | Rollen-Tags, Stufen-Chips, „Aktiv“, „zu klein“, Status-Punkte, getönte Karten (~38) |

Rot nur für Fehler und Gefahr (wie in der Statusleiste festgelegt).

## 7. Ablauf

0. **Konzept** - dieses Dokument, Sammel-Issue #423.
1. **Tokens** (½ Tag, nichts sichtbar).
2. **Komponenten** (1½-2 Tage).
3. **Vorschau-Seite** (½ Tag): versteckte Seite mit jeder Komponente in jedem Zustand, umschaltbar zwischen den fünf Themes, auf Tablet und Handy. **Freigabe durch Marco, bevor umgestellt wird.**
4. **Umstellung** (4-6 Abende, ein Branch, Bühne zuerst): Burger-Menü, Status- und Edit-Leiste, Dashboard-Einstellungen · die 27 Widgets und ihre Einstellungen · Bibliothek, Setlists, Song-Vorschau · System (Einstellungen, Band, Hardware, Geräte, Diagnose) · Song-Editor, Timeline, Cue-Dialog und -Recorder · alle Dialoge, Assistenten, Beitreten und Onboarding · Aufräumen (drei Menüs → `ActionMenu`, Checkboxen → `Switch`/`ToggleChip`).
5. **Wächter** (½ Tag): ein Test schlägt fehl, wenn außerhalb von `ui/` ein Button, Feld oder Dropdown mit eigenen Stil-Klassen geschrieben wird.
6. **Prüfung und Freigabe** (1 Abend): alle Tests; Screenshots aller Bildschirme in einem eckigen, einem weichen und dem Default-Theme auf Fire, Xiaomi und Handy; Marco prüft das **fertige Ergebnis** auf einem Test-Build (Freigabe am Stück); dann Merge und Deploy.

**Risiken:** sehr große Änderung - offene PRs (#399, #405) vorher mergen oder parken. Bühnen-Widgets vorher/nachher per Screenshot vergleichen. Viele Tests prüfen Stil-Klassen (`toHaveClass('bg-accent')`) und müssen angepasst werden.

## 8. Danach: eigene Themes (eigenes Projekt)

Theme-Editor auf den Tokens aus Phase 1: Grundton (dunkel/hell), Akzentfarbe (+ optional zweite für Hauptaktionen), Ecken (eckig · weich · rund), Größe (normal · groß), Schrift (3-4 gut lesbare), Kontrast (normal · hoch), Schatten (an · aus). Leitplanken: Kontrast wird live geprüft und ungenügende Kombinationen lassen sich nicht speichern; Touch-Größen nie unter dem Minimum; Rot bleibt Fehlern vorbehalten; die Statusleiste behält ihre Zustandsfarben. Speicherung wie Dashboards (siehe §3); die fünf heutigen Themes werden geschützte Vorlagen.
