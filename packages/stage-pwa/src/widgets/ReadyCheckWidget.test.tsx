import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WidgetPartsProvider } from '../lib/widgetParts'

const ready = vi.hoisted(() => ({ checkId: null as string | null, status: null as null | { ready: number; total: number; allReady: boolean; missingProfileIds: string[] } }))
const show = vi.hoisted(() => ({ isMaster: true, startReadyCheck: vi.fn(), endReadyCheck: vi.fn() }))
const mode = vi.hoisted(() => ({ mode: 'gig' }))

vi.mock('../lib/useReadyCheck', () => ({ useReadyCheck: () => ready }))
vi.mock('../store/useShowStateStore', () => ({ useShowStateStore: (select: (state: typeof show) => unknown) => select(show) }))
vi.mock('../store/useAppModeStore', () => ({ useAppModeStore: (select: (state: typeof mode) => unknown) => select(mode) }))
vi.mock('../store/useProfilesStore', () => ({
  useProfilesStore: (select: (state: { profiles: { id: string; name: string }[] }) => unknown) => select({ profiles: [{ id: 'p2', name: 'Caro' }] }),
}))

const { ReadyCheckWidget } = await import('./ReadyCheckWidget')

describe('ReadyCheckWidget (own widget since 2026-10-17, was in Next Song)', () => {
  beforeEach(() => {
    ready.checkId = null
    ready.status = null
    show.isMaster = true
    mode.mode = 'gig'
  })

  it('the master starts a check', () => {
    render(<ReadyCheckWidget />)
    fireEvent.click(screen.getByText('Ready-Check'))
    expect(show.startReadyCheck).toHaveBeenCalled()
  })

  it('a non-master sees no button, only who starts it', () => {
    show.isMaster = false
    render(<ReadyCheckWidget />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Ready-Check startet der Master')).toBeInTheDocument()
  })

  it('while a check runs: the count and who is missing - "Wer fehlt" can be left out', () => {
    ready.checkId = 'c1'
    ready.status = { ready: 3, total: 4, allReady: false, missingProfileIds: ['p2'] }
    const { rerender } = render(<ReadyCheckWidget />)
    expect(screen.getByText('3/4 bereit')).toBeInTheDocument()
    expect(screen.getByText('Warten auf: Caro')).toBeInTheDocument()
    rerender(
      <WidgetPartsProvider hidden={['missing']}>
        <ReadyCheckWidget />
      </WidgetPartsProvider>,
    )
    expect(screen.queryByText('Warten auf: Caro')).toBeNull()
  })

  it('says it only works in Gig', () => {
    mode.mode = 'practice'
    render(<ReadyCheckWidget />)
    expect(screen.getByText('Nur im Gig')).toBeInTheDocument()
  })
})
