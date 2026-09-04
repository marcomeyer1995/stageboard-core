import type { ReactNode } from 'react'
import { AudioSyncSettings } from './AudioSyncSettings'
import { DeviceNameSettings } from './DeviceNameSettings'
import { StageServerSettings } from './StageServerSettings'
import { SyncIndicator } from './SyncIndicator'
import { ThemeSwitcher } from './ThemeSwitcher'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-bold uppercase tracking-widest text-ink-faint">{title}</p>
      {children}
    </div>
  )
}

/**
 * The "set once, rarely touched again" device settings - moved out of AppMenu.tsx into
 * SystemView.tsx's own "Einstellungen" tab (see #20, and the 2026-08-30 menu-decluttering
 * pass) so the main menu only shows what's actually touched during a show. `SyncIndicator`
 * moves here too, its own suggested future home per #33's acceptance criteria - the
 * hamburger button's small status dot (App.tsx) covers the discreet at-a-glance case #33
 * originally asked for, this is the detailed view for when someone actually wants it.
 *
 * Vollbild (fullscreen) does *not* live here - Marco asked for it to stay directly in
 * AppMenu.tsx instead, since it's something reached for at the start of a set, not a
 * set-once-and-forget setting like the ones that do belong here.
 */
export function SystemSettings() {
  return (
    <div className="flex flex-col gap-5 p-4">
      <Section title="Gerätename">
        <DeviceNameSettings />
      </Section>

      <Section title="Darstellung">
        <ThemeSwitcher />
      </Section>

      <Section title="Stage-Server">
        <StageServerSettings />
      </Section>

      <Section title="Synchronisation">
        <SyncIndicator />
      </Section>

      <Section title="Speicher & Sync">
        <AudioSyncSettings />
      </Section>
    </div>
  )
}
