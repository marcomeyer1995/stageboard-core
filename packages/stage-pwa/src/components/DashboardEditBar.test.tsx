import { act, fireEvent, render, screen } from '@testing-library/react'
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

function renderBar(dashboard: Dashboard) {
  return render(<DashboardEditBar dashboard={dashboard} breakpoint="lg" capabilities={new Map()} />)
}
function openSettings() {
  fireEvent.click(screen.getByTitle('Menü öffnen'))
}
const action = (name: RegExp) => screen.getByRole('button', { name })

beforeEach(() => {
  save.mockReset()
  me.profile.stageRoles = ['admin']
  useDashboardsStore.setState({ save, dashboards: [board('Bühne'), board('Monitor')] })
})

describe('DashboardEditBar (dashboard editing redesign)', () => {
  it('shows the name, "+ Widget" and "Fertig" right in the bar; a tap on the name renames', async () => {
    renderBar(board('Bühne'))
    expect(screen.getByRole('button', { name: '+ Widget' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bearbeiten beenden' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Bühne/ }))
    await act(async () => useDialogStore.getState().submit({ value: 'Hauptbühne' }))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'Bühne', name: 'Hauptbühne' }))
  })

  it('⋯ holds the rest: modes, status bar, sharing, template (admins), duplicate, delete', () => {
    renderBar(board('Bühne'))
    openSettings()
    fireEvent.click(action(/^Gig: angeboten/))
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ modes: ['practice'] }))
    openSettings()
    fireEvent.click(action(/Statusleiste ausblenden/))
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ statusBar: false }))
    openSettings()
    fireEvent.click(action(/Als Vorlage schützen/))
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ isReadOnly: true }))
    openSettings()
    fireEvent.click(action(/Nur für mich/))
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'private', ownerProfileId: 'p-me' }))
  })

  it('a musician sees no template switch', () => {
    me.profile.stageRoles = []
    renderBar(board('Bühne'))
    openSettings()
    expect(screen.queryByRole('button', { name: /Vorlage/ })).not.toBeInTheDocument()
  })

  it('the last shared dashboard can neither be deleted nor made private, the last of a mode stays offered there', () => {
    useDashboardsStore.setState({ dashboards: [board('Bühne'), board('Privat', { visibility: 'private', ownerProfileId: 'p-me', modes: ['practice'] })] })
    renderBar(board('Bühne'))
    openSettings()
    expect(action(/Dashboard löschen/)).toBeDisabled()
    expect(action(/Nur für mich/)).toBeDisabled()
    expect(action(/^Gig: angeboten/)).toBeDisabled()
  })
})
