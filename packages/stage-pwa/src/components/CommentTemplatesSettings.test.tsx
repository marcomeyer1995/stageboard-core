import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({ default: class {} }))

const { useBandSettingsStore } = await import('../store/useBandSettingsStore')
const { useDialogStore } = await import('../store/useDialogStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { CommentTemplatesSettings } = await import('./CommentTemplatesSettings')

const save = vi.fn(async () => {})
function setAdmin(isAdmin: boolean) {
  useWorkspaceStore.setState({ workspaces: [{ id: 'w', name: 'Band', isAdmin }] as never, activeWorkspaceId: 'w' })
}

beforeEach(() => {
  save.mockClear()
  useBandSettingsStore.setState({ settings: { id: 'band' }, save })
})

describe('CommentTemplatesSettings (#608)', () => {
  it('a new band sees the defaults; an admin adds one and deletes one - saved band-wide', async () => {
    setAdmin(true)
    useDialogStore.setState({ promptText: vi.fn(async () => 'Leise') } as never)
    render(<CommentTemplatesSettings />)
    const list = screen.getByRole('list')
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['A cappella', 'Build-up', 'Solo 8 Takte', 'Auf Drummer achten'])
    fireEvent.click(screen.getByRole('button', { name: 'Neue Vorlage' }))
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ id: 'band', commentTemplates: ['A cappella', 'Build-up', 'Solo 8 Takte', 'Auf Drummer achten', 'Leise'] }))
    fireEvent.click(screen.getByRole('button', { name: 'Vorlage „Build-up“ löschen' }))
    expect(save).toHaveBeenLastCalledWith({ id: 'band', commentTemplates: ['A cappella', 'Solo 8 Takte', 'Auf Drummer achten'] })
  })

  it('a member sees the band\'s list but cannot change it', () => {
    setAdmin(false)
    useBandSettingsStore.setState({ settings: { id: 'band', commentTemplates: ['Nur Bass'] } })
    render(<CommentTemplatesSettings />)
    expect(screen.getByText('Nur Bass')).toBeInTheDocument()
    expect(screen.getByText('Nur der Band-Admin kann die Vorlagen ändern.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Neue Vorlage' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /löschen/ })).not.toBeInTheDocument()
  })
})
