import { useState } from 'react'
import { CAPABILITIES } from 'shared-types'
import { BackupManager } from './BackupManager'
import { BandManagementView } from './BandManagementView'
import { PluginManager } from './PluginManager'
import { PostShowReport } from './PostShowReport'
import { SystemSettings } from './SystemSettings'
import { capabilityStatusFor } from '../lib/capabilities'
import { useCapabilities } from '../lib/useCapabilities'

type SystemTab = 'band' | 'plugins' | 'backup' | 'post-show' | 'settings'

const TAB_LABEL: Record<SystemTab, string> = {
  band: 'Band',
  plugins: 'Plugins',
  backup: 'Backup',
  'post-show': 'Nachbericht',
  settings: 'Einstellungen',
}

/**
 * The "System" pillar of the Live / Bibliothek / System structure #20 originally planned -
 * Plugins, Backup, Nachbericht, the settings that used to live directly in AppMenu.tsx
 * (Darstellung, Sync status, Speicher & Sync - see the 2026-08-30 menu-decluttering pass), and
 * (as of the follow-up the same day) Band - every band/roster *management* action (create,
 * rename, invite, add/rename/reassign-role/delete a member), leaving WorkspaceSwitcher.tsx/
 * ProfileSwitcher.tsx in the main menu as pure selection. One top-level "System" entry in
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
    ? ['band', 'plugins', 'backup', 'post-show', 'settings']
    : ['band', 'plugins', 'post-show', 'settings']
  const [tab, setTab] = useState<SystemTab>('band')
  const activeTab = tabs.includes(tab) ? tab : 'band'

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

      {activeTab === 'band' && <BandManagementView />}
      {activeTab === 'plugins' && <PluginManager />}
      {activeTab === 'backup' && <BackupManager />}
      {activeTab === 'post-show' && <PostShowReport />}
      {activeTab === 'settings' && <SystemSettings />}
    </div>
  )
}
