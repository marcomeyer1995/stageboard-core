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
    fireEvent.click(screen.getByText('1 Cue fehlgeschlagen'))
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

const { useDialogStore } = await import('../store/useDialogStore')

describe('Shows tab - delete and protect (#610)', () => {
  const start = (showId: string, at: number): ShowLogEvent => ({ id: `start-${showId}`, showId, type: 'show-started', at })
  const played = (showId: string, at: number): ShowLogEvent =>
    ({ id: `p-${showId}`, showId, type: 'song-played', at: at + 1000, endedAt: at + 100_000, songId: 'x', songTitle: 'Tush', activeMs: 60_000 }) as ShowLogEvent

  function setup(protectedShowIds: string[]) {
    useProfilesStore.setState({ profiles: [] })
    const setProtected = vi.fn(async () => undefined)
    const deleteShows = vi.fn(async (ids: readonly string[]) => ids.length)
    useShowLogStore.setState({
      events: [start('a', t0), played('a', t0), start('b', t0 + 1e7), played('b', t0 + 1e7), start('c', t0 + 2e7), played('c', t0 + 2e7)],
      protectedShowIds,
      setProtected,
      deleteShows,
    } as never)
    const confirm = vi.fn(async () => true)
    useDialogStore.setState({ confirm } as never)
    render(<Shows />)
    return { setProtected, deleteShows, confirm }
  }

  it('offers nothing to delete or protect until "Bearbeiten"; a protected show shows its lock anyway', () => {
    setup(['b'])
    expect(screen.queryByRole('button', { name: /^Menü: Show \d/ })).not.toBeInTheDocument()
    expect(screen.getAllByLabelText('Geschützt')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }))
    expect(screen.getAllByRole('button', { name: /^Menü: Show \d/ })).toHaveLength(3)
  })

  it('deletes one show after the in-app confirm; a protected one cannot be deleted, only unprotected', async () => {
    const { deleteShows, setProtected, confirm } = setup(['b'])
    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }))
    const menus = screen.getAllByRole('button', { name: /^Menü: Show \d/ })
    // Newest first: c, b, a.
    fireEvent.click(menus[1])
    expect(screen.getByRole('button', { name: 'Löschen (geschützt)' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Schutz aufheben' }))
    expect(setProtected).toHaveBeenCalledWith('b', false, null)

    fireEvent.click(screen.getAllByRole('button', { name: /^Menü: Show \d/ })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }))
    await vi.waitFor(() => expect(deleteShows).toHaveBeenCalledWith(['c']))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('1 Show'), expect.objectContaining({ danger: true }))
  })

  it('"Alle ungeschützten löschen" leaves the protected show out and names the count', async () => {
    const { deleteShows, confirm } = setup(['b'])
    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }))
    fireEvent.click(screen.getByRole('button', { name: 'Menü: Shows' }))
    fireEvent.click(screen.getByRole('button', { name: 'Alle ungeschützten löschen (2)' }))
    await vi.waitFor(() => expect(deleteShows).toHaveBeenCalledWith(['c', 'a']))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('2 Shows'), expect.anything())
  })

  it('"Alle ohne gespielte Songs löschen" takes only the empty ones - the tab does not count them', async () => {
    const { deleteShows } = setup([])
    useShowLogStore.setState({ events: [...useShowLogStore.getState().events, start('d', t0 + 3e7)] })
    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }))
    fireEvent.click(screen.getByRole('button', { name: 'Menü: Shows' }))
    expect(screen.getByRole('button', { name: 'Alle ungeschützten löschen (4, davon 1 ohne Songs)' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Alle ohne gespielte Songs löschen (1)' }))
    await vi.waitFor(() => expect(deleteShows).toHaveBeenCalledWith(['d']))
  })
})
