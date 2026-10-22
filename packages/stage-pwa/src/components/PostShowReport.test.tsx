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

const { useSongVariantsStore } = await import('../store/useSongVariantsStore')
const { useLogicalDevicesStore } = await import('../store/useLogicalDevicesStore')

describe('Nachbericht - "Cue anpassen" saves into the variant (#8)', () => {

  it('opens the cue with its time, and a moved time is saved into the variant the event names', async () => {
    useProfilesStore.setState({ profiles: [] })
    useLogicalDevicesStore.setState({ devices: [{ id: 'mg30', name: 'NUX MG-30', capability: 'mg30-control', pluginId: null, executionTarget: null }] } as never)
    const saveVariant = vi.fn(async () => {})
    const cue = { id: 'cue1', timeMs: 83_400, targetLogicalDeviceId: 'mg30', type: 'mg30.selectPatch', payload: { program: 5 } }
    const other = { id: 'cue2', timeMs: 10_000, targetLogicalDeviceId: 'mg30', type: 'mg30.selectPatch', payload: { program: 1 } }
    useSongVariantsStore.setState({ saveVariant, variants: [{ id: 'v1', songId: 'song1', label: 'Live', isDefault: false, cues: [other, cue] }] } as never)
    useShowLogStore.setState({
      protectedShowIds: [],
      events: [
        { id: 'start', showId: 'show', type: 'show-started', at: t0 },
        song(1, 'Tush'),
        { id: 'f1', showId: 'show', type: 'cue-fired', at: t0 + 300_000, songId: 'song1', songTitle: 'Tush', cueId: 'cue1', variantId: 'v1', cueType: 'mg30.selectPatch', target: 'NUX MG-30', ok: false, message: 'kein Ausgang' },
        { id: 'f2', showId: 'show', type: 'cue-fired', at: t0 + 310_000, songId: 'song1', songTitle: 'Tush', cueId: 'weg', cueType: 'mg30.selectPatch', target: 'NUX MG-30', ok: true },
      ],
    } as never)
    render(<Shows />)
    fireEvent.click(screen.getByText(/1 Song · 3:20 gespielt/))

    // The failed one in sight: its ⋯ → Cue anpassen.
    fireEvent.click(screen.getAllByRole('button', { name: 'Menü: Cue mg30.selectPatch' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Cue anpassen' }))
    expect(screen.getByRole('dialog', { name: /Cue in Tush \(Live\)/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '0,1 s früher' }))
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))
    expect(saveVariant).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1', cues: [other, { ...cue, timeMs: 83_300 }] }))

    // A cue since removed from the song can't be opened.
    const menus = screen.getAllByRole('button', { name: 'Menü: Cue mg30.selectPatch' })
    fireEvent.click(menus[menus.length - 1])
    expect(screen.getByRole('button', { name: 'Cue anpassen (nicht mehr im Song)' })).toBeDisabled()
  })
})
