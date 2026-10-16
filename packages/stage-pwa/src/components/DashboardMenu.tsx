import { DashboardMenuList } from './DashboardMenuList'
import { useActiveDashboardStore } from '../store/useActiveDashboardStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { Drawer } from './ui'

/**
 * The bento menu (nine dots, top right on dashboards - docs/15 D8, Marco 2026-10-16): pick the
 * dashboard, and behind "Bearbeiten" order, hide, create and edit them. It used to be a section of
 * the ☰ menu; switching dashboards is the most frequent thing there, so it gets its own corner.
 */
export function DashboardMenu({ onClose, clearCornerButtons }: { onClose: () => void; clearCornerButtons?: boolean }) {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const setActiveDashboard = useActiveDashboardStore((state) => state.setActive)

  return (
    <Drawer title="Dashboards" side="right" onClose={onClose} clearCornerButtons={clearCornerButtons}>
      <DashboardMenuList
        onSelect={(dashboardId) => {
          setActiveDashboard(workspaceId, dashboardId)
          onClose()
        }}
        onEdit={onClose}
      />
    </Drawer>
  )
}
