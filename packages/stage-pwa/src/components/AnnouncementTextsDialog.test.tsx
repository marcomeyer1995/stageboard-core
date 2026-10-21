import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))

const { usePluginsStore } = await import('../store/usePluginsStore')
const { AnnouncementTextsDialog } = await import('./AnnouncementTextsDialog')

describe('AnnouncementTextsDialog (Marco, 2026-10-16)', () => {
  it('holds this device\'s on/off switch on top, above the band-wide settings', () => {
    usePluginsStore.setState({
      installed: [{ id: 'section-announcements', name: 'Ansagen der Songteile', version: '0.0.1', runtime: 'client', capabilities: ['section-announcements'], transports: [], hardwareIds: [], enabled: true, installedAt: 1 }],
    } as never)
    render(<AnnouncementTextsDialog onClose={() => {}} />)
    const here = screen.getByText('Auf diesem Gerät').closest('section')!
    expect(within(here).getByText('Ansagen der Songteile')).toBeInTheDocument()
  })
})
