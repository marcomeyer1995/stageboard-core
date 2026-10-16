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
import { BackupManager } from './BackupManager'
import { KeybindingSettings } from './KeybindingSettings'
import { LanguageSettings } from './LanguageSettings'
import { FlashSettings } from './FlashSettings'
import { WebAudioTrackSettings } from './WebAudioTrackSettings'
import { AnnouncementSettings } from './AnnouncementSettings'
import { LatencyCompensationSettings } from './LatencyCompensationSettings'
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
      className={`flex flex-col gap-4 rounded-container border bg-surface p-4 shadow-sb ${shared ? 'border-warn/60' : 'border-line'}`}
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

/** One System tab's page: its title, one sentence of what it covers, its groups. */
function Page({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex max-w-3xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        <p className="text-sm text-ink-muted">{description}</p>
      </header>
      {children}
    </div>
  )
}

/*
 * The former "Einstellungen" tab (5-6 screens) split by scope (docs/15 §9 step 3, Marco
 * 2026-10-16): what only this device does, how it sounds and keeps time, and what the Stage-Server
 * does for everyone. Band-wide library settings sit under the Band tab.
 */

/** System → Dieses Gerät: name, look, controls and storage of this tablet or phone only. */
export function DeviceSettings() {
  return (
    <Page title="Dieses Gerät" description="Gilt nur für dieses Tablet oder Handy.">
      <Group title="Gerät" description="Wie dieses Gerät in der Band heißt und welche Sprache es spricht.">
        <Section title="Gerätename">
          <DeviceNameSettings />
        </Section>
        {/* Both languages in the title: found also by someone who can't read the current one (#456). */}
        <Section title="Sprache · Language">
          <LanguageSettings />
        </Section>
      </Group>

      <Group title="Aussehen" description="Farben, Schrift und die Leiste oben.">
        <Section title="Darstellung">
          <ThemeSwitcher />
        </Section>
        <Section title="Textgröße">
          <TextSizeSettings />
        </Section>
        <Section title="Statusleiste">
          <StatusBarSettings />
        </Section>
      </Group>

      <Group title="Fußschalter & Tasten" description="Bluetooth-Pedal oder Tastatur für Weiter, Zurück, Play und den Prompter.">
        <Section title="Zuordnung">
          <KeybindingSettings />
        </Section>
      </Group>

      <Group title="Blitzmeldungen" description="Nachrichten aus dem Stage-Messenger und Hinweise aus dem Songtext ({alert: …}) groß über den Bildschirm.">
        <Section title="Auf diesem Gerät">
          <FlashSettings />
        </Section>
      </Group>

      <Group title="Speicher" description="Welche Audiodateien dieses Gerät für die Songs vorhält.">
        <Section title="Speicher & Sync">
          <AudioSyncSettings />
        </Section>
      </Group>

      <Group title="Bibliothek" description="Was die Bibliothek beim eigenen Üben als „Geübt“ zählt.">
        <Section title="Bibliothek - Geübt">
          <PracticeWindowSettings />
        </Section>
      </Group>

      {isNativeApp() && (
        <Group title="App" description="Version der StageBoard-App und Updates vom Stage-Server.">
          <Section title="Version">
            <AppVersionSettings />
          </Section>
        </Group>
      )}
    </Page>
  )
}

/** System → Ton & Timing: how this device plays the track, the click and the announcements. */
export function SoundTimingSettings() {
  return (
    <Page title="Ton & Timing" description="Wie dieses Gerät Track, Klick und Ansagen ausgibt - nur auf diesem Gerät.">
      <Group title="Wiedergabe" description="Womit der Backing-Track abgespielt wird.">
        <Section title="Wiedergabe (Test)">
          <WebAudioTrackSettings />
        </Section>
      </Group>
      <Group title="Latenz" description="Damit Klick und Track trotz Verzögerung des Ausgangs (z. B. Bluetooth) auf dem Schlag klingen.">
        <Section title="Ausgleich">
          <LatencyCompensationSettings />
        </Section>
      </Group>
      <Group title="Ansagen" description="Gesprochene Songteile über den Klick-Ausgang.">
        <Section title="Songteile">
          <AnnouncementSettings />
        </Section>
      </Group>
    </Page>
  )
}

/** System → Stage-Server: the connection, which band its hardware serves, and its backups. */
export function StageServerPage() {
  return (
    <Page title="Stage-Server" description="Die Verbindung dieses Geräts und was der Server für die ganze Band tut.">
      <Group title="Verbindung" description="Mit welchem Stage-Server dieses Gerät spricht und ob die Band-Daten synchron sind.">
        <Section title="Stage-Server">
          <StageServerSettings />
        </Section>
        <Section title="Synchronisation">
          <SyncIndicator />
        </Section>
      </Group>

      <Group title="Aktive Band - gilt für alle" description="Welche Band die Hardware des Stage-Servers gerade nutzt. Eine Änderung wirkt auf alle Geräte." shared>
        <Section title="Aktive Band (Hardware)">
          <WorkspaceHardwareSettings />
        </Section>
      </Group>

      <BackupManager />
    </Page>
  )
}

/** Under System → Band: the band-wide library setting (until it moves into the Bibliothek). */
export function BandSharedSettings() {
  return (
    <div className="flex max-w-3xl flex-col gap-4 px-4 pb-4">
      <Group title="Bibliothek - gilt für alle" description="Was die Bibliothek als „Geprobt“ zählt. Eine Änderung wirkt auf alle Geräte der Band." shared>
        <Section title="Bibliothek - Geprobt">
          <RehearsalWindowSettings />
        </Section>
      </Group>
    </div>
  )
}
