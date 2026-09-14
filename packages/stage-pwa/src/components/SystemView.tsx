import { useEffect, useState } from 'react'
import { CAPABILITIES } from 'shared-types'
import { BackupManager } from './BackupManager'
import { BandManagementView } from './BandManagementView'
import { DeviceLedgerView } from './DeviceLedgerView'
import { HardwareSetupManager } from './HardwareSetupManager'
import { PluginManager } from './PluginManager'
import { PostShowReport } from './PostShowReport'
import { SystemSettings } from './SystemSettings'
import { capabilityStatusFor } from '../lib/capabilities'
import { useCapabilities } from '../lib/useCapabilities'
import { useInputCapability } from '../lib/useInputCapability'
import { useActiveSystemTabStore, type SystemTab } from '../store/useActiveSystemTabStore'

const TAB_LABEL: Record<SystemTab, string> = {
  band: 'Band',
  plugins: 'Plugins',
  hardware: 'Hardware',
  devices: 'Geräte',
  backup: 'Backup',
  'post-show': 'Nachbericht',
  settings: 'Einstellungen',
}

/**
 * The "System" pillar of the Live / Bibliothek / System structure #20 originally planned -
 * Plugins, Hardware (#10's Logical Device / HardwareSetup admin UI), Backup, Nachbericht, the
 * settings that used to live directly in AppMenu.tsx
 * (Darstellung, Sync status, Speicher & Sync - see the 2026-08-30 menu-decluttering pass), and
 * (as of the follow-up the same day) Band - every band/roster *management* action (create,
 * rename, invite, add/rename/reassign-role/delete a member, and - since the 2026-09-02
 * follow-up - switching which band/profile this device is showing as too, replacing the
 * removed WorkspaceSwitcher.tsx/ProfileSwitcher.tsx entirely). One top-level "System" entry in
 * App.tsx's mode switch instead of many, with its own tab bar here - none of this is touched
 * during a live show, so it doesn't need to cost rows in the main menu just to be reachable.
 *
 * Backup is the only tab still capability-gated (matches BackupManager.tsx's own doc comment:
 * StageBoard never triggers a backup itself, only reports on an installed plugin) - everything
 * else is always relevant regardless of what's installed.
 */
export function SystemView() {
  const capabilities = useCapabilities()
  const hasBackup = capabilityStatusFor([CAPABILITIES.backup], capabilities) !== 'missing'
  const tabs: SystemTab[] = hasBackup
    ? ['band', 'plugins', 'hardware', 'devices', 'backup', 'post-show', 'settings']
    : ['band', 'plugins', 'hardware', 'devices', 'post-show', 'settings']
  const [tab, setTab] = useState<SystemTab>('band')
  const activeTab = tabs.includes(tab) ? tab : 'band'
  const setActiveSystemTab = useActiveSystemTabStore((state) => state.setActiveTab)
  const inputCapability = useInputCapability()

  // Publishes which tab is actually on screen for useHardwareDetection.ts's Hardware-tab gate
  // (see useActiveSystemTabStore.ts's own doc comment) - and clears it back to `null` on
  // unmount, so leaving System (back to Live/Bibliothek) doesn't leave a stale 'hardware' value
  // behind that would otherwise still allow the hot-plug prompt to fire.
  useEffect(() => {
    setActiveSystemTab(activeTab)
  }, [activeTab, setActiveSystemTab])
  useEffect(() => () => setActiveSystemTab(null), [setActiveSystemTab])

  const content = (
    <>
      {activeTab === 'band' && <BandManagementView />}
      {activeTab === 'plugins' && <PluginManager />}
      {activeTab === 'hardware' && <HardwareSetupManager />}
      {activeTab === 'devices' && <DeviceLedgerView />}
      {activeTab === 'backup' && <BackupManager />}
      {activeTab === 'post-show' && <PostShowReport />}
      {activeTab === 'settings' && <SystemSettings />}
    </>
  )

  // Mouse+keyboard lane (#179, rollout step 3/3 of the "UI Tech Rider" concept, following
  // #177/#178): all seven tabs listed vertically in an always-visible sidebar with hover, so a
  // mouse user doesn't have to horizontally scan a strip that only exists because touch needs
  // one. `tab`/`activeTab` state lives above this branch, so switching lanes mid-session (e.g.
  // unplugging a mouse) can't lose the active tab - only which of these two layouts renders it
  // changes.
  if (inputCapability === 'pointer') {
    return (
      <div className="flex h-dvh sb-app-bg text-ink">
        <div className="flex w-56 flex-shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-surface p-2">
          {tabs.map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => setTab(candidate)}
              className={`rounded-sb px-4 py-3 text-left text-sm font-semibold ${
                activeTab === candidate
                  ? 'bg-accent text-accent-ink'
                  : 'bg-control text-ink-soft hover:bg-control-hover'
              }`}
            >
              {TAB_LABEL[candidate]}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">{content}</div>
      </div>
    )
  }

  // Touch lane (phone, tablet portrait and landscape - landscape already fits all seven tabs
  // without scrolling at that width, so it doesn't need the sidebar either): unchanged
  // horizontal tab strip.
  return (
    <div className="h-dvh overflow-y-auto sb-app-bg text-ink">
      <div className="sticky top-0 z-10 flex gap-2 overflow-x-auto border-b border-line bg-surface p-2">
        {tabs.map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => setTab(candidate)}
            className={`flex-shrink-0 rounded-sb px-4 py-2 text-sm font-semibold ${
              activeTab === candidate ? 'bg-accent text-accent-ink' : 'bg-control text-ink-soft hover:bg-control-hover'
            }`}
          >
            {TAB_LABEL[candidate]}
          </button>
        ))}
      </div>

      {content}
    </div>
  )
}
