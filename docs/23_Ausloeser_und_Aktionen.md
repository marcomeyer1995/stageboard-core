# 23 – Auslöser und Aktionen

Konzept (Entwurf 2026-10-18, #547), noch nicht gebaut. Erst lesen und entscheiden, dann bauen.

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
| Show | Play/Pause, Stop, Nächster Song, Vorheriger Song, Stop & nächster Song, Nächster Song und starten, Prompter blättern ↑/↓, **Je nach Zustand** (eine Aktion je Songzustand, wie heute) | der Master; auf anderen Geräten nichts (Hinweis) |
| Abschnitte (#479) | Springe zu „Chorus“, Nächster Abschnitt, Vorheriger Abschnitt, Wiederholen an/aus/umschalten, Sprung absagen – jeweils mit „am Ende des Takts / des Abschnitts“ | der Master |
| Wiedergabe | Klick an/aus, Tempo ± (Tempo-Korrektur), Ready-Check starten | der Master |
| Gerät | „Gerät → Befehl → Wert“ aus dem Befehlskatalog (`deviceCommands/`) – Kemper-Rig, Mischpult-Mute, RC-500-Memory, Blinder | wie ein Cue: das Tablet, an dem das Gerät hängt, oder der Stage-Server |
| Ablauf | eine benannte Folge mehrerer Aktionen („Solo“: Rig 5, Delay an, Kanal 3 lauter) | jede Aktion wie oben |

Abschnitte werden über ihren **Namen** gewählt („Chorus“): dieselbe Aktion passt auf jeden Song, der einen Chorus hat. Hat ein Song den Namen zweimal, springt sie zum nächsten danach.

## 4. Auslöser

| Auslöser | Erkannt an | Gilt für |
|---|---|---|
| Taste / Pedal (Bluetooth-HID) | der Taste (PageDown …) | das eigene Gerät |
| MIDI-Controller | Note oder CC, Kanal, Nummer (bei CC optional Wert) | den Controller als Gerät in Bühnentechnik – er hängt an einem Tablet |
| Widget-Knopf | – | das Dashboard (bandweit wie das Dashboard) |
| Zeitpunkt im Song | die Zeit | der Song – das sind die Cues; sie bleiben, wo sie sind, nutzen aber denselben Aktions-Baustein |
| später: OSC | Adresse | – |

## 5. Regeln und wo sie liegen

- **Pro Gerät:** welche Taste auf diesem Tablet welche Aktion auslöst (ein Pedal gehört einem Musiker) – wie heute „Fußschalter & Tasten“.
- **Bandweit:** die Regeln eines MIDI-Controllers (er ist ein Band-Gerät in Bühnentechnik), die Knöpfe auf Dashboards, die benannten Abläufe.

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

interface Rule { id: string; trigger: Trigger; action: Action }
```

Ein Ausführer `runAction(action)` für alle Auslöser; Gerätebefehle gehen durch dasselbe `fireCue` wie die Cues (gleiche Latenz, gleicher Weg).

## 7. Bedienung

- **Aktion wählen** – ein Dialog, überall gleich: erst die Gruppe (Show, Abschnitte, Wiedergabe, Gerät, Ablauf), dann die Aktion, dann ihre Werte (Abschnitt, Zeitpunkt; bei Geräten dieselben Felder wie im Cue-Dialog).
- **Tasten & Pedale** (System → Dieses Gerät): Liste „Taste → Aktion“, neue Zeile per „Pedal jetzt drücken“ wie heute.
- **MIDI-Controller** (Bühnentechnik): ein Gerät „MIDI-Controller“; in seinem ⋯ „Knöpfe belegen“ – Knopf drücken, Aktion wählen.
- **Widget „Trigger-Button“**: im ⋯-Menü statt Typ + JSON der Aktions-Dialog.

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

1. Eine Show- oder Abschnitts-Aktion auf einem Gerät, das nicht Master ist: nichts tun (mit kurzem Hinweis) – oder dem Master Bescheid geben, der sie ausführt?
2. Abläufe: alle Aktionen sofort hintereinander, oder mit Abständen (in Takten oder ms)?
3. Abschnitte über den Namen („Chorus“) – passt das, oder braucht es auch „Abschnitt Nr. 3“?
4. Soll ein Widget-Knopf auch Show- und Abschnitts-Aktionen auslösen dürfen (dann gibt es eine zweite Art, Weiter oder Springen auf ein Dashboard zu legen)?
