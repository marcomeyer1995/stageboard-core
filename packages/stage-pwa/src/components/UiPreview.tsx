import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBackHandler } from '../lib/backNavigation'
import { initTheme, THEMES, type ThemeId } from '../store/useThemeStore'
import { ActionMenu, ActiveMarker, Badge, Button, Card, ChipGroup, Dialog, Field, IconButton, ListRow, Section, Segmented, Select, Slider, StatusDot, Switch, Tabs, TextArea, ToggleChip } from './ui'

/**
 * The UI system's preview page (docs/15 §7, phase 3): every component in every state, live and
 * switchable between the five themes, for Marco's approval before any screen is converted. The
 * theme switch here is temporary - leaving the page restores this device's own theme.
 */
export function UiPreview({ onClose }: { onClose: () => void }) {
  useBackHandler(onClose)
  const [theme, setTheme] = useState<ThemeId>(() => (document.documentElement.getAttribute('data-theme') as ThemeId) || 'default')
  const [light, setLight] = useState(false)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.classList.toggle('light', theme === 'default' && light)
  }, [theme, light])
  useEffect(() => () => initTheme(), [])

  const [mode, setMode] = useState<'gig' | 'practice'>('gig')
  const [flash, setFlash] = useState<'banner' | 'fullscreen' | 'off'>('banner')
  const [view, setView] = useState<'boards' | 'library' | 'system'>('boards')
  const [recipients, setRecipients] = useState<string[]>(['Caro', 'Hoschi'])
  const [offered, setOffered] = useState<string[]>(['Gig', 'Solo Üben'])
  const [statusBar, setStatusBar] = useState(true)
  const [template, setTemplate] = useState(false)
  const [snap, setSnap] = useState(false)
  const [click, setClick] = useState(true)
  const [tab, setTab] = useState<'band' | 'plugins' | 'hardware' | 'settings'>('band')
  const [seconds, setSeconds] = useState(8)
  const [visibility, setVisibility] = useState<'band' | 'me'>('band')
  const [dialog, setDialog] = useState(false)
  const toggle = (list: string[], set: (next: string[]) => void, item: string, on: boolean) => set(on ? [...list, item] : list.filter((x) => x !== item))

  return createPortal(
    <div className="fixed inset-0 z-dialog flex flex-col bg-stage text-ink-soft sb-app-bg">
      <div className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <h1 className="mr-auto text-lg font-bold text-ink">UI-Vorschau</h1>
        <div className="w-56">
          <Select aria-label="Theme" value={theme} onChange={(e) => setTheme(e.target.value as ThemeId)} options={THEMES.map((t) => ({ value: t.id, label: t.label }))} />
        </div>
        {theme === 'default' && (
          <div className="w-44">
            <Segmented label="Hell oder dunkel" value={light ? 'light' : 'dark'} onChange={(v) => setLight(v === 'light')} options={[{ value: 'dark', label: 'Dunkel' }, { value: 'light', label: 'Hell' }]} />
          </div>
        )}
        <Button icon="close" onClick={onClose}>
          Schließen
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-4xl flex-col gap-8 p-4 pb-16">
          <p className="text-base">
            Alle neuen Bausteine nach docs/15, zum Ausprobieren. Das Theme oben gilt nur hier; beim Schließen kommt das eigene zurück.
          </p>

          <Section title="Aktionen · Button" hint="Hauptaktion gelb, sekundär helles Grau (D3), Gefahr rot, leise ohne Fläche. Größen: Show 72 · Bühne 56 · Formular 48 (D2).">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" size="show" icon="play">
                Play
              </Button>
              <Button variant="primary" size="stage">
                Weiter
              </Button>
              <Button variant="primary">Speichern</Button>
              <Button>Abbrechen</Button>
              <Button variant="danger">Löschen</Button>
              <Button variant="quiet">Mehr anzeigen</Button>
              <Button disabled>Deaktiviert</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <IconButton icon="previous" label="Zurück" size="stage" />
              <IconButton icon="next" label="Weiter" size="stage" />
              <IconButton icon="up" label="Nach oben" />
              <IconButton icon="close" label="Entfernen" variant="quiet" />
              <ActionMenu title="Bohemian Rhapsody" actions={[{ label: 'Bearbeiten', onClick: () => {} }, { label: 'Zur Setlist hinzufügen', onClick: () => {} }, { label: 'Löschen', onClick: () => {}, danger: true }]} />
            </div>
          </Section>

          <Section title="Genau eins wählen · Segmented (D7)" hint="Eine zusammenhängende Leiste; das gewählte Segment gefüllt. Erneut tippen ändert nichts.">
            <Segmented label="Ansicht" size="stage" value={view} onChange={setView} options={[{ value: 'boards', label: 'Boards' }, { value: 'library', label: 'Bibliothek' }, { value: 'system', label: 'System' }]} />
            <Segmented label="Modus" value={mode} onChange={setMode} options={[{ value: 'gig', label: 'Gig' }, { value: 'practice', label: 'Solo Üben' }]} />
            <Segmented label="Blitzmeldungen" value={flash} onChange={setFlash} options={[{ value: 'banner', label: 'Banner' }, { value: 'fullscreen', label: 'Vollbild' }, { value: 'off', label: 'Aus' }]} />
          </Section>

          <Section title="Mehrere wählen · ToggleChip (D7)">
            <ChipGroup label="Empfänger">
              {['Caro', 'Kapper', 'Hoschi', 'Roland'].map((name) => (
                <ToggleChip key={name} label={name} selected={recipients.includes(name)} onToggle={(on) => toggle(recipients, setRecipients, name, on)} />
              ))}
            </ChipGroup>
            <ChipGroup label="Anbieten in">
              {['Gig', 'Solo Üben'].map((m) => (
                <ToggleChip
                  key={m}
                  label={m}
                  selected={offered.includes(m)}
                  // The last one stays: a dashboard is offered in at least one mode.
                  disabled={offered.length === 1 && offered.includes(m)}
                  title={offered.length === 1 && offered.includes(m) ? 'Mindestens ein Modus bleibt' : undefined}
                  onToggle={(on) => toggle(offered, setOffered, m, on)}
                />
              ))}
            </ChipGroup>
          </Section>

          <Section title="An / Aus · Switch (D5)" hint="Eine Einstellung, die sofort wirkt. In Listen ist die ganze Zeile die Tippfläche.">
            <Switch label="Statusleiste anzeigen" checked={statusBar} onChange={setStatusBar} />
            <Switch label="Als Vorlage schützen" description="Nur Admins ändern es, alle können es duplizieren." checked={template} onChange={setTemplate} />
            <p className="text-sm font-semibold text-ink-soft">In einer Werkzeugleiste:</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary">Speichern</Button>
              <Button>Takt 1 hier</Button>
              <Switch layout="inline" label="Klick" checked={click} onChange={setClick} />
              <Switch layout="inline" label="Einrasten" checked={snap} onChange={setSnap} />
            </div>
          </Section>

          <Section title="Seiten wechseln · Tabs">
            <Tabs label="System" value={tab} onChange={setTab} tabs={[{ value: 'band', label: 'Band' }, { value: 'plugins', label: 'Plugins' }, { value: 'hardware', label: 'Hardware' }, { value: 'settings', label: 'Einstellungen' }]} />
          </Section>

          <Section title="Eingaben · Field, Select, Slider">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" placeholder="z. B. Bühne links" hint="So heißt es im Menü." />
              <Field label="BPM" defaultValue="abc" error="Bitte eine Zahl eingeben." />
              <Select label="Tonart" defaultValue="A" options={['C', 'D', 'E', 'F', 'G', 'A', 'B'].map((k) => ({ value: k, label: k }))} />
              <Slider label="Anzeigedauer" valueLabel={`${seconds} s`} min={3} max={20} value={seconds} onChange={setSeconds} />
            </div>
            <TextArea label="Notiz" placeholder="Für die Crew…" />
          </Section>

          <Section title="Listen · ListRow, ActiveMarker (D4)" hint="Gewählter Wert = gelbe Fläche. „Aktiv / das bist du“ = gelbe Umrandung + Badge.">
            <div className="flex flex-col gap-2">
              <ListRow title="Prompter" subtitle="Gig · Solo" selected onClick={() => {}} trailing={<Badge>Vorlage</Badge>} />
              <ListRow title="Monitoring" subtitle="Gig" onClick={() => {}} trailing={<ActionMenu title="Monitoring" actions={[{ label: 'Umbenennen', onClick: () => {} }]} />} />
              <ActiveMarker active badge="Du">
                <ListRow title="Marco" subtitle="Admin · Crew" leading={<StatusDot status="ok" label="online" />} onClick={() => {}} />
              </ActiveMarker>
              <ListRow title="Caro" leading={<StatusDot status="off" label="offline" />} onClick={() => {}} />
            </div>
          </Section>

          <Section title="Karten, Badges, Status">
            <div className="grid gap-3 sm:grid-cols-2">
              <Card>
                <p className="text-base font-semibold text-ink">Karte</p>
                <p className="text-sm text-ink-faint">Liegt auf der Seite, ohne Schatten.</p>
              </Card>
              <Card raised>
                <p className="text-base font-semibold text-ink">Schwebende Karte</p>
                <p className="text-sm text-ink-faint">Mit Schatten, z. B. über einem Dashboard.</p>
              </Card>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Admin</Badge>
              <Badge tone="accent">Gig</Badge>
              <Badge tone="warning">zu klein</Badge>
              <Badge tone="danger">Fehler</Badge>
              <StatusDot status="ok" />
              <StatusDot status="warning" />
              <StatusDot status="error" />
              <StatusDot status="off" />
            </div>
          </Section>

          <Section title="Dialog (D6)" hint="„× Schließen“ oben rechts, Aktionen unten: sekundär links, Hauptaktion rechts.">
            <div>
              <Button onClick={() => setDialog(true)}>Dialog öffnen</Button>
            </div>
          </Section>

          <Section title="Zusammen · Dashboard-Einstellungen" hint="Ein Bildschirm, der alle Arten braucht.">
            <Card raised className="flex flex-col gap-5">
              <ChipGroup label="Anbieten in">
                {['Gig', 'Solo Üben'].map((m) => (
                  <ToggleChip key={m} label={m} selected={offered.includes(m)} disabled={offered.length === 1 && offered.includes(m)} onToggle={(on) => toggle(offered, setOffered, m, on)} />
                ))}
              </ChipGroup>
              <Section title="Sichtbar für">
                <Segmented label="Sichtbar für" value={visibility} onChange={setVisibility} options={[{ value: 'band', label: 'Ganze Band' }, { value: 'me', label: 'Nur ich' }]} />
              </Section>
              <div className="flex flex-col gap-2">
                <Switch label="Statusleiste anzeigen" checked={statusBar} onChange={setStatusBar} />
                <Switch label="Als Vorlage schützen" checked={template} onChange={setTemplate} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button>Duplizieren</Button>
                <Button variant="danger">Dashboard löschen</Button>
              </div>
            </Card>
          </Section>
        </div>
      </div>

      {dialog && (
        <Dialog
          title="Neue Setlist"
          onClose={() => setDialog(false)}
          actions={
            <>
              <Button onClick={() => setDialog(false)}>Abbrechen</Button>
              <Button variant="primary" onClick={() => setDialog(false)}>
                Anlegen
              </Button>
            </>
          }
        >
          <Field label="Name der Setlist" placeholder="z. B. Sommerfest" />
          <Switch label="Songs gleich mit hinzufügen" checked={false} onChange={() => {}} />
        </Dialog>
      )}
    </div>,
    document.body,
  )
}
