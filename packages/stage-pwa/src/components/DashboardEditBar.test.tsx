import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Dashboard } from 'shared-types'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))
const me = vi.hoisted(() => ({ profile: { id: 'p-me', name: 'Marco', stageRoles: ['admin'] as string[] } }))
vi.mock('../lib/useActiveProfile', () => ({ useActiveProfile: () => me.profile }))

const { useDashboardsStore } = await import('../store/useDashboardsStore')
const { useDialogStore } = await import('../store/useDialogStore')
const { DashboardEditBar } = await import('./DashboardEditBar')

const board = (id: string, extra: Partial<Dashboard> = {}): Dashboard => ({ id, name: id, order: 0, widgets: [], layouts: {}, visibility: 'public', ...extra })
const save = vi.fn()
const rename = vi.fn()

function renderBar(dashboard: Dashboard) {
  return render(<DashboardEditBar dashboard={dashboard} breakpoint="lg" capabilities={new Map()} />)
}
function openSettings() {
  fireEvent.click(screen.getByRole('button', { name: 'Dashboard-Einstellungen' }))
}
const action = (name: RegExp | string) => screen.getByRole('button', { name })

beforeEach(() => {
  save.mockReset()
  rename.mockReset()
  me.profile.stageRoles = ['admin']
  useDashboardsStore.setState({ save, rename, dashboards: [board('Bühne'), board('Monitor')] })
})

describe('DashboardEditBar (dashboard editing redesign)', () => {
  it('shows the name, "+ Widget" and "Fertig" right in the bar; a tap on the name renames', async () => {
    renderBar(board('Bühne'))
    expect(screen.getByRole('button', { name: 'Widget' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bearbeiten beenden' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Bühne/ }))
    await act(async () => useDialogStore.getState().submit({ value: 'Hauptbühne' }))
    // Through the store's rename - against the freshly read dashboard, not a spread of this copy (#422 review).
    expect(rename).toHaveBeenCalledWith('Bühne', 'Hauptbühne')
  })

  it('⋯ opens the settings: chips for the modes, a bar for the audience, switches for on/off (docs/15)', () => {
    renderBar(board('Bühne'))
    openSettings()
    expect(screen.getByRole('dialog', { name: 'Einstellungen: Bühne' })).toBeInTheDocument()
    expect(action('Gig')).toHaveAttribute('aria-pressed', 'true')
    expect(action('Gig')).toHaveClass('bg-accent')
    fireEvent.click(action('Gig'))
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ modes: ['practice'] }))
    fireEvent.click(screen.getByRole('switch', { name: /Statusleiste/ }))
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ statusBar: false }))
    fireEvent.click(screen.getByRole('switch', { name: /Vorlage/ }))
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ isReadOnly: true }))
    fireEvent.click(screen.getByRole('radio', { name: 'Nur ich' }))
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'private', ownerProfileId: 'p-me' }))
  })

  it('a musician sees no template switch', () => {
    me.profile.stageRoles = []
    renderBar(board('Bühne'))
    openSettings()
    expect(screen.queryByRole('switch', { name: /Vorlage/ })).not.toBeInTheDocument()
  })

  it('the last shared dashboard can neither be deleted nor made private, the last of a mode stays offered there', () => {
    useDashboardsStore.setState({ dashboards: [board('Bühne'), board('Privat', { visibility: 'private', ownerProfileId: 'p-me', modes: ['practice'] })] })
    renderBar(board('Bühne'))
    openSettings()
    expect(action('Dashboard löschen')).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Nur ich' })).toBeDisabled()
    expect(action('Gig')).toBeDisabled()
  })

  it('the only dashboard of a mode cannot be deleted - like its mode chip (#422 review)', () => {
    useDashboardsStore.setState({ dashboards: [board('Bühne', { modes: ['practice'] }), board('Monitor', { modes: ['gig'] })] })
    renderBar(board('Bühne', { modes: ['practice'] }))
    openSettings()
    expect(action('Dashboard löschen')).toBeDisabled()
  })

  it('only a band admin can reset all dashboards (Marco, 2026-10-08)', () => {
    me.profile.stageRoles = []
    renderBar(board('Bühne'))
    openSettings()
    expect(screen.queryByRole('button', { name: 'Alle Dashboards zurücksetzen' })).not.toBeInTheDocument()
  })

  it('the reset question says how many dashboards go, also other members\' private ones (2026-10-08)', async () => {
    const confirm = vi.fn(async () => false)
    useDialogStore.setState({ confirm })
    useDashboardsStore.setState({ dashboards: [board('Bühne'), board('Monitor'), board('Caros', { visibility: 'private', ownerProfileId: 'p-caro' })] })
    renderBar(board('Bühne'))
    openSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Alle Dashboards zurücksetzen' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.stringContaining('alle 3 Dashboards der Band, auch 1 private von anderen Mitgliedern'), expect.objectContaining({ danger: true })))
  })
})

