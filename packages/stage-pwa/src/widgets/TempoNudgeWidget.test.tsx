import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SessionMode } from '../store/useAppModeStore'
import { TempoNudgeWidget } from './TempoNudgeWidget'
import { useShowMode } from '../lib/showMode'

vi.mock('../lib/showMode', () => ({ useShowMode: vi.fn() }))

function mockShowMode(overrides: {
  mode?: SessionMode
  liveTempoAdjustPercent?: number
  canControl?: boolean
  setLiveTempoAdjustPercent?: (percent: number) => void
  nudgeLiveTempoAdjustPercent?: (deltaPercent: number) => void
}) {
  vi.mocked(useShowMode).mockReturnValue({
    mode: overrides.mode ?? 'gig',
    liveTempoAdjustPercent: overrides.liveTempoAdjustPercent ?? 0,
    setLiveTempoAdjustPercent: overrides.setLiveTempoAdjustPercent ?? vi.fn(),
    nudgeLiveTempoAdjustPercent: overrides.nudgeLiveTempoAdjustPercent ?? vi.fn(),
    canControl: overrides.canControl ?? true,
  } as never)
}

describe('TempoNudgeWidget', () => {
  it('explains itself away in Practice mode instead of offering a no-op control', () => {
    mockShowMode({ mode: 'practice' })
    render(<TempoNudgeWidget />)
    expect(screen.getByText('Nur im Gig-Modus verfügbar')).toBeInTheDocument()
  })

  it('shows 0% with no reset button when there is no adjustment', () => {
    mockShowMode({ liveTempoAdjustPercent: 0 })
    render(<TempoNudgeWidget />)
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.queryByText('Zurücksetzen')).not.toBeInTheDocument()
  })

  it('nudges the percent by +/-1 via the delta setter, not a value computed from a stale prop', () => {
    const nudgeLiveTempoAdjustPercent = vi.fn()
    mockShowMode({ liveTempoAdjustPercent: 3, nudgeLiveTempoAdjustPercent })
    render(<TempoNudgeWidget />)
    fireEvent.click(screen.getByText('+'))
    expect(nudgeLiveTempoAdjustPercent).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByText('−'))
    expect(nudgeLiveTempoAdjustPercent).toHaveBeenCalledWith(-1)
  })

  it('resets to 0 via the reset button once adjusted', () => {
    const setLiveTempoAdjustPercent = vi.fn()
    mockShowMode({ liveTempoAdjustPercent: 7, setLiveTempoAdjustPercent })
    render(<TempoNudgeWidget />)
    fireEvent.click(screen.getByText('Zurücksetzen'))
    expect(setLiveTempoAdjustPercent).toHaveBeenCalledWith(0)
  })

  it('disables + at the upper limit and - at the lower limit', () => {
    mockShowMode({ liveTempoAdjustPercent: 15 })
    render(<TempoNudgeWidget />)
    expect(screen.getByText('+')).toBeDisabled()
    expect(screen.getByText('−')).not.toBeDisabled()
  })

  it('disables both step buttons and reset for a non-Master device', () => {
    mockShowMode({ liveTempoAdjustPercent: 5, canControl: false })
    render(<TempoNudgeWidget />)
    expect(screen.getByText('+')).toBeDisabled()
    expect(screen.getByText('−')).toBeDisabled()
    expect(screen.getByText('Zurücksetzen')).toBeDisabled()
  })
})
