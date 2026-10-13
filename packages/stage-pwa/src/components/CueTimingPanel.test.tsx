import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CueTimingPanel } from './CueTimingPanel'
import { recordStall, recordTick, recordWatched, resetCueTimingStats } from '../lib/cueTimingStats'

describe('CueTimingPanel (#477)', () => {
  beforeEach(() => resetCueTimingStats())

  it('asks for a song before anything was measured', () => {
    render(<CueTimingPanel />)
    expect(screen.getByText(/Noch keine Messung/)).toBeTruthy()
  })

  it('shows the longest stall and the scheduler pauses once songs played', () => {
    recordWatched(120_000)
    recordStall(60)
    recordStall(140)
    recordTick(25)
    recordTick(90)
    render(<CueTimingPanel />)
    expect(screen.getByText(/während 2 min Wiedergabe: 2/)).toBeTruthy()
    expect(screen.getByText('140 ms')).toBeTruthy()
    expect(screen.getByText('90 ms')).toBeTruthy()
  })
})
