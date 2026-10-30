import { fireEvent, render, screen, within } from '@testing-library/react'
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
  it('lists the played songs first, then everything in order in the timeline (#673)', () => {
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
    const timeline = within(screen.getByRole('region', { name: /Ablauf/ }))
    const lines = timeline.getAllByRole('listitem').map((item) => item.textContent)
    // Show start, 3 device changes, 2 songs (start + end each), 1 note = 9 lines, by time.
    expect(lines).toHaveLength(9)
    expect(lines[0]).toMatch(/Show gestartet/)
    expect(lines.findIndex((line) => /Highway to Hell beginnt/.test(line ?? ''))).toBeLessThan(lines.findIndex((line) => /Free Bird beginnt/.test(line ?? '')))
    expect(lines.some((line) => /Notiz von .*Gitarre zu laut/.test(line ?? ''))).toBe(true)
    // A category chip hides its lines.
    fireEvent.click(timeline.getByRole('button', { name: 'Geräte' }))
    expect(timeline.getAllByRole('listitem')).toHaveLength(6)
  })

  it('shows every fired cue in the timeline, the failed ones also in sight above with the reason (#8)', () => {
    useProfilesStore.setState({ profiles: [] })
    const cue = (n: number, ok: boolean, message?: string) =>
      ({ id: `q${n}`, showId: 'show', type: 'cue-fired', at: t0 + n * 30_000, songId: 'song1', songTitle: 'Highway to Hell', cueId: `cue${n}`, cueType: 'kemper.selectRig', target: 'Marcos Kemper', ok, ...(message ? { message } : {}) }) as ShowLogEvent
    useShowLogStore.setState({
      events: [{ id: 'start', showId: 'show', type: 'show-started', at: t0 }, song(1, 'Highway to Hell'), cue(1, true), cue(2, false, 'kein MIDI-Ausgang'), cue(3, true)],
    } as never)
    render(<Shows />)
    fireEvent.click(screen.getByText('1 Cue fehlgeschlagen'))
    expect(screen.getByText('Cues fehlgeschlagen (1)')).toBeInTheDocument()
    expect(screen.getAllByText(/kemper.selectRig → Marcos Kemper - kein MIDI-Ausgang/)).toHaveLength(2)
    expect(screen.getAllByText(/kemper.selectRig → Marcos Kemper$/)).toHaveLength(2)
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

describe('Nachbericht - what happened, when and how (#673)', () => {
  it('names every kind of event in words, with the song time where known', () => {
    useProfilesStore.setState({ profiles: [] })
    const e = (id: string, offset: number, rest: Record<string, unknown>) => ({ id, showId: 'show', at: t0 + offset, ...rest })
    useShowLogStore.setState({
      protectedShowIds: [],
      events: [
        { id: 'start', showId: 'show', type: 'show-started', at: t0 },
        song(1, 'Tush'),
        e('p1', 241_000, { type: 'playback', action: 'pause', songId: 'song1', songTitle: 'Tush', positionMs: 65_000 }),
        e('j1', 250_000, { type: 'section', action: 'jump', songId: 'song1', songTitle: 'Tush', fromLabel: 'Solo', toLabel: 'Chorus 2', fromMs: 120_000, toMs: 150_000 }),
        e('m1', 260_000, { type: 'master', deviceName: 'Redmi', profileName: 'Marco', forced: true }),
        e('r1', 270_000, { type: 'ready-check', action: 'ended', ready: ['Marco'], missing: ['Caro'] }),
        e('t1', 280_000, { type: 'sound', what: 'tempo', songId: 'song1', songTitle: 'Tush', value: '3' }),
        e('f1', 290_000, { type: 'flash', text: 'Kürzer!', from: 'Marco', to: [] }),
        e('i1', 300_000, { type: 'item-played', endedAt: t0 + 345_000, title: 'Merch-Ansage', style: 'announcement', activeMs: 45_000, plannedMs: 30_000 }),
      ],
    } as never)
    render(<Shows />)
    fireEvent.click(screen.getByText(/1 Song · 3:20 gespielt/))
    expect(screen.getByText('Pause · Tush')).toBeInTheDocument()
    expect(screen.getByText('bei 1:05')).toBeInTheDocument()
    expect(screen.getByText('Sprung Solo → Chorus 2')).toBeInTheDocument()
    expect(screen.getByText('Redmi (Marco) ist jetzt Master (dem laufenden Master abgenommen)')).toBeInTheDocument()
    expect(screen.getByText('Ready-Check beendet: 1 bereit · es fehlte: Caro')).toBeInTheDocument()
    expect(screen.getByText('Tempo-Korrektur +3 % · Tush')).toBeInTheDocument()
    expect(screen.getByText('Nachricht von Marco an alle: „Kürzer!“')).toBeInTheDocument()
    expect(screen.getByText('Merch-Ansage · 0:45 (geplant 0:30)')).toBeInTheDocument()
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

    // The failed one in sight, in words while the song still has it: its ⋯ → Cue anpassen.
    expect(screen.getAllByText(/Tush · Patch 02B → NUX MG-30 - kein Ausgang/)).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'Menü: Cue Patch 02B' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Cue anpassen' }))
    expect(screen.getByRole('dialog', { name: /Cue in Tush \(Live\)/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '0,1 s früher' }))
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))
    expect(saveVariant).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1', cues: [other, { ...cue, timeMs: 83_300 }] }))

    // A cue since removed from the song can't be opened - and only its raw type is left to show.
    const menus = screen.getAllByRole('button', { name: 'Menü: Cue mg30.selectPatch' })
    fireEvent.click(menus[menus.length - 1])
    expect(screen.getByRole('button', { name: 'Cue anpassen (nicht mehr im Song)' })).toBeDisabled()
  })

  it("a Rig-Check's cue is changed where it comes from, not in the generated song", () => {
    useProfilesStore.setState({ profiles: [] })
    useLogicalDevicesStore.setState({ devices: [] } as never)
    useSongVariantsStore.setState({ variants: [{ id: 'rig-check-quick', songId: 'rig-check', label: 'Kurz', isDefault: true, cues: [{ id: 'rc', timeMs: 10_000, targetLogicalDeviceId: 'k', type: 'kemper.selectRig', payload: {} }] }] } as never)
    useShowLogStore.setState({
      protectedShowIds: [],
      events: [
        { id: 'start', showId: 'show', type: 'show-started', at: t0 },
        song(1, 'Rig-Check'),
        { id: 'f1', showId: 'show', type: 'cue-fired', at: t0 + 300_000, songId: 'rig-check', songTitle: 'Rig-Check', cueId: 'rc', variantId: 'rig-check-quick', cueType: 'kemper.selectRig', target: 'Kemper', ok: true },
      ],
    } as never)
    render(<Shows />)
    fireEvent.click(screen.getByText(/1 Song · 3:20 gespielt/))
    fireEvent.click(screen.getByRole('button', { name: 'Menü: Cue kemper.selectRig' }))
    expect(screen.getByRole('button', { name: 'Cue anpassen (unter System → Rig-Check)' })).toBeDisabled()
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

describe('Shows in English (#456)', () => {
  it('the list and a show read in English - band content (song titles) stays as it is', async () => {
    const { default: i18n } = await import('../i18n')
    await i18n.changeLanguage('en')
    try {
      useProfilesStore.setState({ profiles: [] })
      useShowLogStore.setState({
        protectedShowIds: [],
        events: [
          { id: 'start', showId: 'show', type: 'show-started', at: t0 },
          { id: 'p', showId: 'show', type: 'song-played', at: t0 + 1000, endedAt: t0 + 200_000, songId: 'tush', songTitle: 'Tush', activeMs: 200_000 },
        ],
      } as never)
      render(<Shows />)
      expect(screen.getByText('Recorded automatically')).toBeInTheDocument()
      fireEvent.click(screen.getByText(/1 song · 3:20 played/))
      expect(screen.getByText('Tush')).toBeInTheDocument()
    } finally {
      await i18n.changeLanguage('de')
    }
  })
})
