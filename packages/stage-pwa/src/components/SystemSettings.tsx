import type { ReactNode } from 'react'
import { AppVersionSettings } from './AppVersionSettings'
import { AudioSyncSettings } from './AudioSyncSettings'
import { isNativeApp } from '../lib/native'
import { DeviceNameSettings } from './DeviceNameSettings'
import { StageServerSettings } from './StageServerSettings'
import { SyncIndicator } from './SyncIndicator'
import { TextSizeSettings } from './TextSizeSettings'
import { StatusBarSettings } from './StatusBarSettings'
import { ThemeSwitcher } from './ThemeSwitcher'
import { WorkspaceHardwareSettings } from './WorkspaceHardwareSettings'
import { KeybindingSettings } from './KeybindingSettings'
import { FlashSettings } from './FlashSettings'
import { PracticeWindowSettings, RehearsalWindowSettings } from './LibrarySettings'

/**
 * One visibly separate group (#371: the flat list of seven same-looking sections was "chaotic,
 * hard to find the right clusters"). A card with a real heading and one sentence of purpose;
 * `shared` marks the group whose settings affect every device of the band, set apart in colour.
 */
function Group({
  title,
  description,
  shared = false,
  children,
}: {
  title: string
  description: string
  shared?: boolean
  children: ReactNode
}) {
  return (
    <section
      aria-label={title}
      className={`flex flex-col gap-4 rounded-container border bg-surface p-4 shadow-sb ${shared ? 'border-amber-500/60' : 'border-line'}`}
    >
      <header className="flex flex-col gap-1">
        <h3 className="text-lg font-bold text-ink">{title}</h3>
        <p className="text-sm text-ink-muted">{description}</p>
      </header>
      {children}
    </section>
  )
}

/** A labelled setting inside a group. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3 first-of-type:border-t-0 first-of-type:pt-0">
      <p className="text-sm font-semibold uppercase tracking-wide text-ink-soft">{title}</p>
      {children}
    </div>
  )
}

export function SystemSettings() {
  return (
    <div className="flex max-w-3xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-bold text-ink">Einstellungen</h2>
        <p className="text-sm text-ink-muted">Gilt nur für dieses Gerät - außer im Bereich „Band &amp; Server“ ganz unten.</p>
      </header>

      <Group title="Dieses Gerät" description="Name, Aussehen und Speicher dieses Geräts.">
        <Section title="Gerätename">
          <DeviceNameSettings />
        </Section>
        <Section title="Darstellung">
          <ThemeSwitcher />
        </Section>
        <Section title="Textgröße">
          <TextSizeSettings />
        </Section>
        <Section title="Speicher & Sync">
          <AudioSyncSettings />
        </Section>
        <Section title="Bibliothek - Geübt">
          <PracticeWindowSettings />
        </Section>
      </Group>

      <Group title="Statusleiste" description="Was die Leiste oben zeigt und was zuerst weichen darf, wenn der Platz knapp wird - nur auf diesem Gerät.">
        <Section title="Reihenfolge">
          <StatusBarSettings />
        </Section>
      </Group>

      <Group title="Fußschalter & Tasten" description="Bluetooth-Pedal oder Tastatur für Weiter, Zurück, Play und den Prompter - gilt nur für dieses Gerät.">
        <Section title="Zuordnung">
          <KeybindingSettings />
        </Section>
      </Group>

      <Group title="Blitzmeldungen" description="Nachrichten aus dem Stage-Messenger und Hinweise aus dem Songtext ({alert: …}) groß über den Bildschirm.">
        <Section title="Auf diesem Gerät">
          <FlashSettings />
        </Section>
      </Group>

      <Group title="Verbindung" description="Mit welchem Stage-Server dieses Gerät spricht und ob die Band-Daten synchron sind.">
        <Section title="Stage-Server">
          <StageServerSettings />
        </Section>
        <Section title="Synchronisation">
          <SyncIndicator />
        </Section>
      </Group>

      {isNativeApp() && (
        <Group title="App" description="Version der StageBoard-App und Updates vom Stage-Server.">
          <Section title="Version">
            <AppVersionSettings />
          </Section>
        </Group>
      )}

      <Group
        title="Band & Server - gilt für alle"
        description="Welche Band die Hardware des Stage-Servers gerade nutzt, und was die Bibliothek als „Geprobt“ zählt. Eine Änderung wirkt auf alle Geräte der Band."
        shared
      >
        <Section title="Aktive Band (Hardware)">
          <WorkspaceHardwareSettings />
        </Section>
        <Section title="Bibliothek - Geprobt">
          <RehearsalWindowSettings />
        </Section>
      </Group>
    </div>
  )
}
