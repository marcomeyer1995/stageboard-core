import type { ReactNode } from 'react'
import { InfoHint } from './ui'
import { AppVersionSettings } from './AppVersionSettings'
import { AudioSyncSettings } from './AudioSyncSettings'
import { isNativeApp } from '../lib/native'
import { DeviceNameSettings } from './DeviceNameSettings'
import { StageServerSettings } from './StageServerSettings'
import { SyncIndicator } from './SyncIndicator'
import { TextSizeSettings } from './TextSizeSettings'
import { StatusBarSettingsEntry } from './StatusBarSettings'
import { ThemeSwitcher } from './ThemeSwitcher'
import { WorkspaceHardwareSettings } from './WorkspaceHardwareSettings'
import { BackupManager } from './BackupManager'
import { KeybindingSettings } from './KeybindingSettings'
import { LanguageSettings } from './LanguageSettings'
import { FlashSettings } from './FlashSettings'
import { OutputRoutingSettings } from './OutputRoutingSettings'
import { useTranslation } from 'react-i18next'

/**
 * One visibly separate group (#371: the flat list of seven same-looking sections was "chaotic,
 * hard to find the right clusters"). A card with a real heading and one sentence of purpose;
 * `shared` marks the group whose settings affect every device of the band, set apart in colour.
 */
export function Group({
  title,
  info,
  shared = false,
  children,
}: {
  title: string
  info: string
  shared?: boolean
  children: ReactNode
}) {
  const { t } = useTranslation('system')
  return (
    <section
      aria-label={title}
      className={`flex flex-col gap-4 rounded-container border bg-surface p-4 shadow-sb ${shared ? 'border-warn/60' : 'border-line'}`}
    >
      {/* What the card is for sits behind ⓘ (docs/15 D12, #625) - read once, then only in the way. */}
      <header className="flex min-w-0 items-center gap-1">
        <h3 className="min-w-0 text-lg font-bold text-ink">{title}</h3>
        <InfoHint text={info} label={t('explain', { title })} />
      </header>
      {children}
    </section>
  )
}

/** A labelled setting inside a group; `info` is its explanation behind ⓘ (docs/15 D12). */
function Section({ title, info, children }: { title: string; info?: string; children: ReactNode }) {
  const { t } = useTranslation('system')
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3 first-of-type:border-t-0 first-of-type:pt-0">
      <div className="flex min-w-0 items-center gap-1">
        <p className="min-w-0 text-sm font-semibold uppercase tracking-wide text-ink-soft">{title}</p>
        {info && <InfoHint text={info} label={t('explain', { title })} />}
      </div>
      {children}
    </div>
  )
}

/** One System tab's page: its title, one sentence of what it covers, its groups. */
export function Page({ title, info, children }: { title: string; info: string; children: ReactNode }) {
  const { t } = useTranslation('system')
  return (
    <div className="flex max-w-3xl flex-col gap-4 p-4">
      <header className="flex min-w-0 items-center gap-1">
        <h1 className="min-w-0 text-2xl font-bold text-ink">{title}</h1>
        <InfoHint text={info} label={t('explain', { title })} />
      </header>
      {children}
    </div>
  )
}

/*
 * The former "Einstellungen" tab (5-6 screens) split by scope (docs/15 §9 step 3, Marco
 * 2026-10-16): what only this device does, and what the Stage-Server does for everyone. The short-
 * lived "Ton & Timing" tab is gone again: latency sits in "Latenz…" (Tablets & Handys), the
 * announcements switch with the Ansagen add-on, the Web Audio test switch in Diagnose. What "Geübt" / "Geprobt" count sits in the Bibliothek beside that sort.
 */

/** System → Dieses Gerät: name, look, controls and storage of this tablet or phone only. */
export function DeviceSettings() {
  const { t } = useTranslation('system')
  return (
    <Page title={t('device.title')} info={t('device.info')}>
      <Group title={t('device.group')} info={t('device.groupInfo')}>
        <Section title={t('device.name')}>
          <DeviceNameSettings />
        </Section>
        {/* Both languages in the title: found also by someone who can't read the current one (#456). */}
        <Section title={t('device.language')}>
          <LanguageSettings />
        </Section>
      </Group>

      <Group title={t('device.look')} info={t('device.lookInfo')}>
        <Section title={t('device.theme')}>
          <ThemeSwitcher />
        </Section>
        <Section title={t('device.textSize')} info={t('device.textSizeInfo')}>
          <TextSizeSettings />
        </Section>
        <Section title={t('device.statusBar')}>
          <StatusBarSettingsEntry />
        </Section>
      </Group>

      <Group title={t('device.pedals')} info={t('device.pedalsInfo')}>
        <Section
          title={t('device.mapping')}
          info={t('device.mappingInfo')}
        >
          <KeybindingSettings />
        </Section>
      </Group>

      <Group title={t('device.flash')} info={t('device.flashInfo')}>
        <Section title={t('device.onThisDevice')}>
          <FlashSettings />
        </Section>
      </Group>

      <Group title={t('device.sound')} info={t('device.soundInfo')}>
        <Section
          title={t('device.output')}
          info={t('device.outputInfo')}
        >
          <OutputRoutingSettings />
        </Section>
      </Group>

      <Group title={t('device.storage')} info={t('device.storageInfo')}>
        <Section title={t('device.storageSync')}>
          <AudioSyncSettings />
        </Section>
      </Group>

      {isNativeApp() && (
        <Group title={t('device.app')} info={t('device.appInfo')}>
          <Section title={t('device.version')}>
            <AppVersionSettings />
          </Section>
        </Group>
      )}
    </Page>
  )
}

/** System → Stage-Server: the connection, which band its hardware serves, and its backups. */
export function StageServerPage() {
  const { t } = useTranslation('system')
  return (
    <Page title={t('server.title')} info={t('server.info')}>
      <Group title={t('server.connection')} info={t('server.connectionInfo')}>
        <Section title={t('server.server')}>
          <StageServerSettings />
        </Section>
        <Section title={t('server.sync')}>
          <SyncIndicator />
        </Section>
      </Group>

      <Group title={t('server.activeBand')} info={t('server.activeBandInfo')} shared>
        <Section title={t('server.activeBandHw')}>
          <WorkspaceHardwareSettings />
        </Section>
      </Group>

      {/* A card like every other topic of the page (2026-10-20: it sat bare below the cards). */}
      <Group title={t('server.backup')} info={t('server.backupInfo')}>
        <BackupManager />
      </Group>
    </Page>
  )
}
