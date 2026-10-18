# 23 – Auslöser und Aktionen

Konzept (2026-10-18, #547), mit Marco entschieden (§4a, §5a, §10). **Schritt 1 gebaut (2026-10-18):** Aktionen (`lib/actions.ts`), ein Ausführer mit Rechteprüfung (`lib/runAction.ts`), Gerätebefehle über `lib/deviceAction.ts` (derselbe Weg wie der Trigger-Button), Tasten & Pedale mit Tastend/Rastend/Zeitgesteuert (`useFootswitch.ts`) und dem Aktions-Dialog (`components/ActionPicker.tsx`); gespeicherte Belegungen werden umgeschrieben (Speicherversion 3). Zeitgesteuert in Schlägen/Takten mit **„Auf den Takt“** (Standard bei neuen Belegungen, `lib/gridRelease.ts`): die zweite Aktion landet auf dem Taktanfang (Schlag) N Takte nach dem dem Drücken nächsten – auf dem Raster des Songs (Tempowechsel im Song inklusive, ein vorgemerkter Abschnittssprung auch); ein Gerätebefehl geht 1 s vorher mit seinem Zeitpunkt und dem Latenzausgleich raus wie ein Cue. Ohne den Schalter oder wenn der Song nicht läuft: ein Timer nach dem Tempo beim Drücken. Eine Live-Tempo-Korrektur zwischen Drücken und Ziel wird nicht nachgeführt. **Schritt 3 gebaut (2026-10-18, vor Schritt 2):** Widget „Trigger-Button“ auf dem Aktions-Dialog – jede Aktion, Tastend/Rastend/Zeitgesteuert mit demselben Editor (`components/BehaviorEditor.tsx`) und derselben Drück-Logik (`lib/triggerPress.ts`) wie die Pedale; ohne Show-Kontrolle ist ein Show-Knopf ausgegraut mit Grund. Alte Knöpfe (Gerät + Typ + JSON) werden beim Lesen als derselbe Gerätebefehl gelesen und beim ersten Öffnen des ⋯-Menüs als Aktion gespeichert. **Schritt 2 gebaut (2026-10-18):** Gerätetyp „MIDI-Controller“ (Capability `midi-controller`, Anschluss: MIDI-Eingang des Tablets, an dem er steckt); im ⋯ des Geräts „Knöpfe belegen“ – Knopf am Controller drücken (nur an diesem Tablet, sonst von Hand: Note/CC/Program, Kanal, Nummer, bei CC optional ein fester Wert), dann Verhalten und Aktionen wie bei den Pedalen. Regeln bandweit (`midi-controller-rules`), das Tablet mit dem Controller hört zu (`lib/useMidiControllers.ts`). Note an/aus bzw. CC >0/0 sind Drücken/Loslassen, Program Change nur Drücken. Der alte MIDI-Fußtaster („jede Note = nächster Abschnitt“ in der Übungsuhr) bleibt für Eingänge ohne Controller-Gerät; Eingänge eines Controllers lässt er aus. **Schritt 4 gebaut (2026-10-18):** Abläufe – im Aktions-Dialog fünfte Gruppe „Ablauf“: wählen, „Neuer Ablauf“, „Bearbeiten“ (Name, Schritte, vor jedem weiteren Schritt eine Pause in ms, Schlägen oder Takten). Bandweit (`action-sequence`). Beim Auslösen werden alle Zeitpunkte vorab berechnet – Schläge/Takte auf dem Raster des laufenden Songs (vom dem Drücken nächsten Taktanfang aus), sonst nach dem Songtempo –, Gerätebefehle gehen vorausgeplant raus (`scheduleActionAt`), jeder Schritt mit seinen eigenen Rechten. Kein Ablauf in einem Ablauf. Seitdem geht auch „Zeitgesteuert“ ohne „Auf den Takt“ als vorausgeplanter Gerätebefehl raus (gleicher Zeitpunkt, nur pünktlicher).

## 1. Ausgangslage

Heute gibt es vier getrennte Wege, etwas auszulösen – jeder mit eigenem Format:

| Was | Auslöser | Was passiert | Wo gespeichert |
|---|---|---|---|
| Fußschalter & Tasten (#27, `lib/keybindings.ts`) | Taste / Bluetooth-Pedal | nur Show-Steuerung (Weiter, Play, Prompter blättern), auch „Je nach Zustand“ | pro Gerät (lokal) |
| Cues in der Timeline (docs/14 §7) | Zeitpunkt im Song | Gerätebefehl „Gerät → Befehl → Wert“ (`deviceCommands/`) | im Song (Variante) |
| Widget „Trigger-Button“ | Knopf auf dem Dashboard | Gerätebefehl als Freitext (Typ + JSON) | im Dashboard (bandweit) |
| MIDI-Fußtaster (`useMidiTrigger.ts`) | jede MIDI-Note | fest: nächster Abschnitt (nur Übungsuhr) | – |

Dazu kommt mit #479 das Springen und Wiederholen von Abschnitten, das bisher nur das Widget „Abschnitte“ auslösen kann.

## 2. Ziel

Ein System: **„Wenn [Auslöser], dann [Aktion]“**. Eine Aktion ist überall derselbe Baustein – ob ein Pedal, ein MIDI-Controller, ein Widget-Knopf oder ein Zeitpunkt im Song sie auslöst.

## 3. Aktionen

| Gruppe | Aktionen | Wer führt aus |
|---|---|---|
| Show | Play/Pause, Stop, Nächster Song, Vorheriger Song, Stop & nächster Song, Nächster Song und starten, Prompter blättern ↑/↓, **Je nach Zustand** (eine Aktion je Songzustand, wie heute) | der Master – siehe §5a |
| Abschnitte (#479) | Springe zu „Chorus“, Nächster Abschnitt, Vorheriger Abschnitt, Wiederholen an/aus/umschalten, Sprung absagen – jeweils mit „am Ende des Takts / des Abschnitts“ | der Master |
| Wiedergabe | Klick an/aus, Tempo ± (Tempo-Korrektur), Ready-Check starten | der Master |
| Gerät | „Gerät → Befehl → Wert“ aus dem Befehlskatalog (`deviceCommands/`) – Kemper-Rig, Mischpult-Mute, RC-500-Memory, Blinder | wie ein Cue: das Tablet, an dem das Gerät hängt, oder der Stage-Server |
| Ablauf | eine benannte Folge mehrerer Aktionen („Solo“: Rig 5, Delay an, Kanal 3 lauter) | jede Aktion wie oben |

Abschnitte werden über ihren **Namen** gewählt („Chorus“, entschieden 2026-10-18): dieselbe Aktion passt auf jeden Song, der einen Chorus hat. Hat ein Song den Namen zweimal, springt sie zum nächsten danach.

## 4. Auslöser

| Auslöser | Erkannt an | Gilt für |
|---|---|---|
| Taste / Pedal (Bluetooth-HID) | der Taste (PageDown …) | das eigene Gerät |
| MIDI-Controller | Note oder CC, Kanal, Nummer (bei CC optional Wert) | den Controller als Gerät in Bühnentechnik – er hängt an einem Tablet |
| Widget-Knopf | – | das Dashboard (bandweit wie das Dashboard) |
| Zeitpunkt im Song | die Zeit | der Song – das sind die Cues; sie bleiben, wo sie sind, nutzen aber denselben Aktions-Baustein |
| später: OSC | Adresse | – |

### 4a. Drücken und Loslassen (entschieden 2026-10-18, Marco)

Jeder Auslöser hat zwei Momente – **Drücken** und **Loslassen** (Pedal: Taste runter/hoch, MIDI: Note an/aus bzw. CC hoch/0, Widget-Knopf: Finger drauf/weg). Je Belegung wählt man das Verhalten:

| Verhalten | Drücken | Loslassen / Ende | Beispiel |
|---|---|---|---|
| **Tastend** | Aktion „an“ | Aktion „aus“ beim Loslassen (optional) | Blinder, solange gedrückt |
| **Rastend** | 1. Druck: Aktion A | 2. Druck: Aktion B | Effekt an / Effekt aus |
| **Zeitgesteuert** | Aktion „an“ | Aktion „aus“ automatisch nach einer Zeit (ms) oder nach N Takten/Schlägen – egal, wann losgelassen wird | Blinder für genau 2 Takte |

Die Loslass-Aktion ist optional; ohne sie tut Loslassen nichts (heute: alle Pedal-Belegungen). Takte und Schläge zählen auf dem Raster des laufenden Songs; ohne laufenden Song gilt die Zeit nach dem Songtempo. Ein rastender Knopf zeigt seinen Zustand (an/aus) im Widget.

## 5. Regeln und wo sie liegen

- **Pro Gerät:** welche Taste auf diesem Tablet welche Aktion auslöst (ein Pedal gehört einem Musiker) – wie heute „Fußschalter & Tasten“.
- **Bandweit:** die Regeln eines MIDI-Controllers (er ist ein Band-Gerät in Bühnentechnik), die Knöpfe auf Dashboards, die benannten Abläufe.

### 5a. Rechte (entschieden 2026-10-18, Marco)

Ein Auslöser löst nur aus, was das Gerät bzw. der angemeldete Musiker selbst darf – das Rechtesystem gilt für jeden Weg gleich. Wer weder Master ist noch Master werden darf, hat keine Kontrolle über die Show: Show-, Abschnitts- und Wiedergabe-Aktionen tun auf seinem Gerät nichts (kurzer Hinweis), sie werden auch **nicht** an den Master weitergereicht. Prompter blättern betrifft nur den eigenen Bildschirm und geht immer.

**Gerätebefehle** dagegen darf jeder Musiker von jedem Gerät auslösen – ohne Master zu sein, egal ob das Gerät an seinem Tablet, an einem anderen oder am Stage-Server hängt (entschieden 2026-10-18: der Lichttechniker am FOH steuert das Licht, das am Stage-Server hängt, während der Gitarrist Master ist). Eine Einschränkung nach Rollen („nur die Licht-Rolle steuert das Licht“) wäre ein späterer Schritt (#57).

## 6. Datenmodell (Skizze)

```ts
type Action =
  | { kind: 'show'; op: 'play-pause' | 'stop' | 'next' | 'previous' | 'stop-next' | 'next-play' | 'prompter-down' | 'prompter-up' }
  | { kind: 'by-state'; steps: Record<SongState, StepAction> }          // heutiges „Je nach Zustand“
  | { kind: 'section'; op: 'jump' | 'next' | 'previous' | 'loop-toggle' | 'loop-on' | 'loop-off' | 'cancel'; label?: string; when?: 'bar' | 'section' }
  | { kind: 'playback'; op: 'click-toggle' | 'tempo-up' | 'tempo-down' | 'ready-check' }
  | { kind: 'device'; targetLogicalDeviceId: string; type: string; payload: Record<string, unknown> }
  | { kind: 'sequence'; sequenceId: string }

type Trigger =
  | { kind: 'key'; key: string }
  | { kind: 'midi'; controllerId: string; message: 'note' | 'cc'; channel: number; number: number; value?: number }

type Release = { kind: 'none' } | { kind: 'on-release'; action: Action } | { kind: 'after'; amount: number; unit: 'ms' | 'beats' | 'bars'; action: Action }

type Behavior =
  | { kind: 'momentary'; press: Action; release: Release }   // tastend oder zeitgesteuert
  | { kind: 'latching'; on: Action; off: Action }             // rastend

interface Rule { id: string; trigger: Trigger; behavior: Behavior }
```

Ein Ausführer `runAction(action)` für alle Auslöser; Gerätebefehle gehen durch dasselbe `fireCue` wie die Cues (gleiche Latenz, gleicher Weg).

## 7. Bedienung

- **Aktion wählen** – ein Dialog, überall gleich: erst die Gruppe (Show, Abschnitte, Wiedergabe, Gerät, Ablauf), dann die Aktion, dann ihre Werte (Abschnitt, Zeitpunkt; bei Geräten dieselben Felder wie im Cue-Dialog).
- **Tasten & Pedale** (System → Dieses Gerät): Liste „Taste → Aktion“, neue Zeile per „Pedal jetzt drücken“ wie heute.
- **MIDI-Controller** (Bühnentechnik): ein Gerät „MIDI-Controller“; in seinem ⋯ „Knöpfe belegen“ – Knopf drücken, Aktion wählen.
- **Widget „Trigger-Button“**: im ⋯-Menü statt Typ + JSON der Aktions-Dialog – mit allen Aktionen, auch Show und Abschnitte (entschieden 2026-10-18), und dem Verhalten aus §4a (heute schon „tastend/rastend“ als Freitext-Payload).

## 8. Übergang

- Bestehende Tastenbelegungen werden beim ersten Start automatisch umgeschrieben (feste Aktion → `show`, „Je nach Zustand“ → `by-state`) – niemand muss sein Pedal neu einrichten.
- Trigger-Buttons mit Gerät, Typ und JSON werden zu einer `device`-Aktion; mit unlesbarem JSON bleiben sie, wie sie sind, mit Hinweis.
- Der feste MIDI-Fußtaster („jede Note = nächster Abschnitt“) wird zu einer voreingestellten Regel, die man ändern kann.

## 9. Reihenfolge

1. Aktionen + Ausführer, Tasten & Pedale darauf umgestellt, mit den Abschnitts-Aktionen – **ersetzt #479 Schritt 4**.
2. MIDI-Controller als Gerät mit „Knöpfe belegen“.
3. Trigger-Button auf den Aktions-Dialog.
4. Abläufe.
5. später OSC.

## 10. Offene Fragen

1. ~~Nicht-Master~~ – entschieden: §5a.
2. ~~Abläufe mit Abständen~~ – entschieden: Abstände in ms, Schlägen oder Takten sind gewünscht (siehe §4a „Zeitgesteuert“; in Abläufen ebenso).
3. ~~Name oder Nummer~~ – entschieden: über den Namen.
4. ~~Widget-Knopf~~ – entschieden: ja, jede Aktion (Show, Abschnitte, Wiedergabe, Gerät, Ablauf) – so vielseitig wie möglich; die Rechte (§5a) gelten auch hier.
5. ~~Gerätebefehle ohne Master~~ – entschieden: erlaubt, für jedes Gerät (§5a).

## 11. Überarbeitung: Schalter (Entwurf 2026-10-18, noch nicht entschieden)

### 11.1 Problem

Nach Schritt 1–4 ist die *Aktion* ein gemeinsamer Baustein, das *Verhalten* aber nicht. Tastend/Rastend/Zeitgesteuert samt Aktionen wird an drei Stellen getrennt festgelegt:

| Wo | Was dort steht | Gespeichert |
|---|---|---|
| Taste / Pedal | Verhalten + Aktionen | pro Tablet |
| MIDI-Controller-Knopf | dasselbe noch einmal | bandweit |
| Trigger-Button | dasselbe noch einmal | im Dashboard |

Folgen (Marco, 2026-10-18):

- **Doppelt einrichten:** ein Blinder, der per Dashboard-Knopf und per MIDI-Pedal geht, wird zweimal angelegt und muss zweimal geändert werden.
- **Kein gemeinsamer Zustand:** jede Stelle hat ihren eigenen An/Aus-Zustand. Hält jemand das Pedal, leuchtet der Dashboard-Knopf nicht. Schaltet man einen rastenden Effekt per Pedal an, steht der Knopf noch auf „aus“, und sein nächster Druck schaltet wieder „an“.
- **Keine Übersicht:** nirgends sieht man, was alles den Blinder auslöst.

### 11.2 Idee: ein Schalter, viele Auslöser

Ein **Schalter** ist ein benanntes, bandweites Ding: „Blinder“, „Solo“, „Delay“. Er hat:

- einen **Namen** und eine **Farbe**,
- ein **Verhalten**: tastend, rastend oder zeitgesteuert (§4a),
- seine **Aktionen**: beim Drücken / Loslassen bzw. 1. / 2. Druck bzw. danach; jede Aktion darf auch eine Folge mit Pausen sein. Abläufe (Schritt 4) gehen damit in den Schaltern auf: ein Ablauf ist ein tastender Schalter, dessen Druck-Aktion eine Folge ist.
- einen **Zustand**: gedrückt / an / aus. Es gibt ihn einmal für die ganze Band.

**Auslöser zeigen nur auf einen Schalter:**

- Pedal-Taste B → „Blinder“. Welche Taste welchen Schalter auslöst, bleibt pro Tablet, denn das Pedal gehört einem Musiker.
- FCB Note 36 → „Blinder“ (bandweit, wie der Controller).
- Dashboard-Knopf → „Blinder“: der Knopf übernimmt Name und Farbe, Beschriftung optional überschreibbar.

**Ein Druck wirkt auf den Schalter, nicht auf den Auslöser:**

- *Rastend:* jeder Auslöser schaltet um. Pedal schaltet an, der Knopf leuchtet, ein Tipp auf den Knopf schaltet aus.
- *Tastend:* der Schalter ist gedrückt, solange irgendein Auslöser gedrückt ist; erst wenn der letzte losgelassen wird, kommt die Loslass-Aktion.
- *Zeitgesteuert:* der Schalter leuchtet vom Drücken bis zur zweiten Aktion; ein neuer Druck startet die Zeit neu.

Jeder Knopf, der auf den Schalter zeigt, leuchtet bei jedem Druck, egal von welchem Auslöser auf welchem Tablet. Das gilt auch beim Lichttechniker am FOH.

### 11.3 Einfache Aktionen bleiben direkt

Nicht alles braucht einen Schalter: „Nächster Song“ auf einem Pedal hat keinen Zustand und wird selten mehrfach belegt. Ein Auslöser wählt deshalb entweder

- **eine Aktion direkt** (wie heute, immer „tastend ohne Loslassen“), oder
- **einen Schalter** aus der Liste.

Im Aktions-Dialog gibt es dafür „Als Schalter speichern…“: aus der gerade gewählten Aktion samt Verhalten wird ein Schalter, den andere Auslöser wiederverwenden.

### 11.4 Übersicht „Schalter“

Neue Seite im Tab **Band**: alle Schalter der Band, je Zeile Name, Farbe, Verhalten, aktueller Zustand und **womit er ausgelöst wird**, z. B.:

> **Blinder** · tastend · Pedal B (Marco, Xiaomi), FCB Note 36, Knopf auf „Monitoring“

Antippen öffnet den Schalter zum Bearbeiten. Eine Änderung gilt für alle Auslöser. Löschen fragt nach und nennt die betroffenen Auslöser.

### 11.5 Zustand über alle Tablets

- Der Zustand muss schnell überall ankommen: ein Knopf, der erst nach einer Sekunde leuchtet, wirkt kaputt. Die Datenbank-Replikation braucht bis zu 1 s (docs/19 §6). Deshalb geht der Zustand über den **schnellen Show-State-Weg** (`showStatePush.ts`, Stage-Server `/show-state/push` → `/show-state/stream`), den Play/Pause heute schon nutzen. Zusätzlich wird er in die Datenbank geschrieben, damit ein Tablet, das später dazukommt, ihn kennt.
- **Wer den Zustand führt:** das Tablet, auf dem gedrückt wurde. Es schickt „Blinder gedrückt / losgelassen / an / aus“ mit Server-Zeit. Bei zwei gleichzeitigen Drücken auf verschiedenen Tablets gilt der spätere (Server-Zeit).
- **Ein Tablet fällt weg, während es gedrückt hält** (Akku, WLAN): ein gedrückter Schalter fällt nach einer Wartezeit ohne Lebenszeichen von selbst auf „losgelassen“, damit kein Blinder ewig an bleibt. Rastende Schalter bleiben, wie sie sind.
- **Rechte (§5a) gelten unverändert:** pro Aktion im Moment der Ausführung. Ein Schalter mit Show-Aktion ist auf einem Tablet ohne Show-Kontrolle ausgegraut. Ein Schalter, der nur Gerätebefehle sendet, geht überall.

### 11.6 Was „leuchtet“ bedeutet

Der Knopf zeigt den **Zustand des Schalters** in StageBoard, nicht den echten Zustand des Geräts. Stellt jemand den Effekt direkt am Kemper aus, leuchtet der Knopf weiter. Den echten Gerätezustand anzeigen (Rückmeldung per MIDI vom Gerät) wäre ein späterer, eigener Schritt pro Geräte-Plugin.

### 11.7 Datenmodell (Skizze)

```ts
interface Switch {
  id: string
  name: string
  color: WidgetColor
  behavior: Behavior            // §6 - Aktionen dürfen Folgen mit Pausen sein
}

// Auslöser zeigen auf eine Aktion oder einen Schalter:
type Target = { kind: 'action'; action: Action } | { kind: 'switch'; switchId: string }

// Zustand, schnell verteilt (§11.5):
interface SwitchState { switchId: string; state: 'pressed' | 'on' | 'off'; at: number; byDevice: string; holders: string[] }
```

Pedal-Belegung, MIDI-Regel und Trigger-Button speichern statt eines eigenen `Behavior` ein `Target`.

### 11.8 Übergang

- Bestehende Pedal-Belegungen, MIDI-Knöpfe und Trigger-Buttons mit **gleichem Verhalten und gleichen Aktionen** werden zu **einem** Schalter zusammengeführt; Name aus der Knopf-Beschriftung, sonst aus der Aktion („Kemper: Rig 5“).
- Alles mit einer einzelnen Aktion ohne Loslassen bleibt eine direkte Aktion.
- Abläufe werden zu Schaltern (tastend, Druck = Folge); die Aktion „Ablauf X“ zeigt danach auf den Schalter.

### 11.9 Reihenfolge

1. Schalter + Übersicht + „Als Schalter speichern“; Auslöser können auf Schalter zeigen; Zustand nur auf dem eigenen Tablet.
2. Zustand bandweit über den schnellen Weg, Knöpfe leuchten überall, Ausfall-Regel (§11.5).
3. Abläufe in Schalter überführen, alte Formen automatisch umschreiben (§11.8).

### 11.10 Offene Fragen

1. **Name:** „Schalter“ oder anders („Funktion“, „Taster“)?
2. **Tastend über mehrere Auslöser:** Loslass-Aktion erst, wenn der *letzte* loslässt (Vorschlag, §11.2), oder bei jedem Loslassen?
3. **Ausfall-Wartezeit** für einen gedrückt gehaltenen Schalter, dessen Tablet wegfällt: Vorschlag 3 s.
4. **Direkte Aktionen** behalten (§11.3), oder muss alles über einen Schalter gehen (einheitlicher, aber mehr Klicks)?
5. **Pedal-Belegung** weiter pro Tablet (Vorschlag), oder auch bandweit mit „gilt für Tablet …“?
