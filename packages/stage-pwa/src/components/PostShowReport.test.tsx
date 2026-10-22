import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ShowLogEvent } from 'shared-types'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))

const { ShowDetail, ShowList, useShows } = await import('./PostShowReport')
const { pauseBefore } = await import('../lib/showPauses')

/** List and detail as the Bibliothek's "Shows" tab puts them together. */
function Shows() {
  const shows = useShows()
  const [open, setOpen] = useState<string | null>(null)
  return open ? (
    <>
      <button type="button" onClick={() => setOpen(null)}>
        Bibliothek
      </button>
      <ShowDetail showId={open} />
    </>
  ) : (
    <ShowList shows={shows} selectedId={open} onOpen={setOpen} />
  )
}
const { useShowLogStore } = await import('../store/useShowLogStore')
const { useProfilesStore } = await import('../store/useProfilesStore')

const t0 = new Date('2026-09-27T20:00:00').getTime()
const song = (n: number, title: string): ShowLogEvent =>
  ({ id: `s${n}`, showId: 'show', type: 'song-played', at: t0 + n * 240_000, endedAt: t0 + n * 240_000 + 200_000, songId: `song${n}`, songTitle: title, activeMs: 200_000 }) as ShowLogEvent
const tech = (n: number): ShowLogEvent =>
  ({ id: `c${n}`, showId: 'show', type: 'capability-changed', at: t0 + n * 60_000, capability: 'click-track', from: 'degraded', to: 'available' }) as ShowLogEvent

describe('PostShowReport (GUI audit 2026-09-26)', () => {
  it('lists the played songs first and folds technical events into one "Technik" line', () => {
    useProfilesStore.setState({ profiles: [] })
    useShowLogStore.setState({
      events: [
        { id: 'start', showId: 'show', type: 'show-started', at: t0 },
        tech(1), song(1, 'Highway to Hell'), tech(3), tech(5), song(2, 'Free Bird'),
        { id: 'n1', showId: 'show', type: 'note', at: t0 + 500_000, text: 'Gitarre zu laut', authorProfileId: null },
      ],
    } as never)
    render(<Shows />)
    fireEvent.click(screen.getByText(/2 Songs · 6:40 gespielt/))
    expect(screen.getByText('Highway to Hell')).toBeInTheDocument()
    expect(screen.getByText('Notizen (1)')).toBeInTheDocument()
    const technik = screen.getByText('Technik (3)')
    expect(technik.closest('details')).not.toHaveAttribute('open')
  })

  it('shows every fired cue folded away, the failed ones in sight with the reason (#8)', () => {
    useProfilesStore.setState({ profiles: [] })
    const cue = (n: number, ok: boolean, message?: string) =>
      ({ id: `q${n}`, showId: 'show', type: 'cue-fired', at: t0 + n * 30_000, songId: 'song1', songTitle: 'Highway to Hell', cueId: `cue${n}`, cueType: 'kemper.selectRig', target: 'Marcos Kemper', ok, ...(message ? { message } : {}) }) as ShowLogEvent
    useShowLogStore.setState({
      events: [{ id: 'start', showId: 'show', type: 'show-started', at: t0 }, song(1, 'Highway to Hell'), cue(1, true), cue(2, false, 'kein MIDI-Ausgang'), cue(3, true)],
    } as never)
    render(<Shows />)
    fireEvent.click(screen.getByText('1 Cues fehlgeschlagen'))
    expect(screen.getByText('Cues fehlgeschlagen (1)')).toBeInTheDocument()
    expect(screen.getByText(/kemper.selectRig → Marcos Kemper - kein MIDI-Ausgang/)).toBeInTheDocument()
    expect(screen.getByText('Cues (3, 1 fehlgeschlagen)').closest('details')).not.toHaveAttribute('open')
  })

  it('lists the shows and opens one at a time; starts with nothing in them fold away (2026-10-16)', () => {
    useProfilesStore.setState({ profiles: [] })
    const later = t0 + 86_400_000
    useShowLogStore.setState({
      events: [
        { id: 'start', showId: 'show', type: 'show-started', at: t0 },
        song(1, 'Highway to Hell'),
        { id: 'start2', showId: 'test', type: 'show-started', at: later },
      ],
    } as never)
    render(<Shows />)
    expect(screen.queryByText('Highway to Hell')).not.toBeInTheDocument()
    expect(screen.getByText('Ohne gespielte Songs (1)').closest('details')).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText(/1 Song · 3:20 gespielt/))
    expect(screen.getByText('Highway to Hell')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Bibliothek' }))
    expect(screen.getByText('Ohne gespielte Songs (1)')).toBeInTheDocument()
  })
})

describe('Nachbericht - planned vs. actual (#64)', () => {
  const played = (id: string, at: number, endedAt: number, activeMs: number, extra: Record<string, number> = {}) =>
    ({ id, showId: 'show', type: 'song-played', songId: id, songTitle: id, at, endedAt, activeMs, ...extra }) as Extract<ShowLogEvent, { type: 'song-played' }>

  it('a pause counts from the end of the song before until this one played, waiting for Play included', () => {
    const a = played('a', t0, t0 + 200_000, 200_000, { plannedPauseAfterMs: 30_000 })
    // b activated 10 s after a ended, then 20 s until Play: 30 s of dead air - as planned.
    const b = played('b', t0 + 210_000, t0 + 410_000, 180_000)
    expect(pauseBefore(a, b)).toEqual({ ms: 30_000, plannedMs: 30_000, tooLong: false })
    // 46 s: more than the planned 30 s + 15 s.
    const late = played('c', t0 + 216_000, t0 + 426_000, 180_000)
    expect(pauseBefore(a, late).tooLong).toBe(true)
  })

  it('shows each song against its planned length and marks the pause that ran too long', () => {
    useProfilesStore.setState({ profiles: [] })
    useShowLogStore.setState({
      events: [
        { id: 'start', showId: 'show', type: 'show-started', at: t0 },
        played('Tush', t0, t0 + 200_000, 200_000, { plannedMs: 192_000, plannedPauseAfterMs: 30_000 }),
        played('Mexiko', t0 + 260_000, t0 + 440_000, 180_000, { plannedMs: 185_000 }),
      ],
    } as never)
    render(<Shows />)
    fireEvent.click(screen.getByText(/2 Songs · 6:20 gespielt/))
    expect(screen.getByText(/3:20 \(\+0:08\)/)).toBeInTheDocument()
    expect(screen.getByText(/3:00 \(-0:05\)/)).toBeInTheDocument()
    expect(screen.getByText('Pause 1:00 · geplant 0:30 (+0:30)')).toBeInTheDocument()
    expect(screen.getByText(/1 Pause zu lang/)).toBeInTheDocument()
  })
})
