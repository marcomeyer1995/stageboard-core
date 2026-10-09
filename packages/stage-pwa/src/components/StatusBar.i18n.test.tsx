import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { default: i18n } = await import('../i18n')
const { StatusBar } = await import('./StatusBar')

afterEach(async () => {
  await act(() => i18n.changeLanguage('de'))
})

describe('StatusBar in another language (#456)', () => {
  it('switches its texts at once, without a reload', async () => {
    render(<StatusBar screen="library" onOpenMenu={() => {}} />)
    expect(screen.getByRole('button', { name: 'Menü öffnen' })).toBeInTheDocument()
    expect(screen.getAllByText('Bibliothek').length).toBeGreaterThan(0)
    await act(() => i18n.changeLanguage('en'))
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
    expect(screen.getAllByText('Library').length).toBeGreaterThan(0)
    expect(screen.queryByText('Bibliothek')).not.toBeInTheDocument()
  })
})
