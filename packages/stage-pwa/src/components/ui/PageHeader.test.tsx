import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PageHeader } from './PageHeader'

describe('PageHeader (docs/15 D12)', () => {
  it('⋮ is there with only a main action, and names it - icon up top, icon and word in ⋮', () => {
    const save = vi.fn()
    render(<PageHeader back={{ label: 'Zurück', onClick: vi.fn() }} actions={[{ icon: 'save', label: 'Speichern', variant: 'primary', onClick: save }]} menuTitle="Herbst-Tour" />)

    fireEvent.click(screen.getByRole('button', { name: 'Menü: Herbst-Tour' }))
    const menu = screen.getByRole('dialog')
    fireEvent.click(within(menu).getByRole('button', { name: 'Speichern' }))
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('the main actions come first in ⋮, the rarer ones after them', () => {
    render(
      <PageHeader
        actions={[{ icon: 'edit', label: 'Bearbeiten', onClick: vi.fn() }]}
        menu={{ title: 'Setlist', actions: [{ label: 'Deaktivieren', onClick: vi.fn() }, { label: 'Löschen', danger: true, onClick: vi.fn() }] }}
        title="Setlist"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Menü: Setlist' }))
    const labels = within(screen.getByRole('dialog')).getAllByRole('button').map((b) => b.textContent)
    expect(labels.slice(0, 3)).toEqual(['Bearbeiten', 'Deaktivieren', 'Löschen'])
  })
})
