import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Song } from 'shared-types'
import { NewSetlistDialog } from './NewSetlistDialog'

const songs = [
  { id: 'a', title: 'All the small things', artist: 'Blink-182' },
  { id: 'b', title: 'Bohemian Rhapsody', artist: 'Queen' },
  { id: 'c', title: 'Highway to hell', artist: 'AC DC' },
] as unknown as Song[]

describe('NewSetlistDialog (#183)', () => {
  it('"Anlegen" with no songs ticked creates an empty setlist, like before', () => {
    const onDone = vi.fn()
    render(<NewSetlistDialog songs={songs} onCancel={vi.fn()} onDone={onDone} />)
    fireEvent.change(screen.getByLabelText('Name der neuen Setlist'), { target: { value: '  Sommerfest  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
    expect(onDone).toHaveBeenCalledWith('Sommerfest', [])
  })

  it('ticked songs become the entries in the order shown, whatever order they were ticked in', () => {
    const onDone = vi.fn()
    render(<NewSetlistDialog songs={songs} onCancel={vi.fn()} onDone={onDone} />)
    fireEvent.change(screen.getByLabelText('Name der neuen Setlist'), { target: { value: 'Gig' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Highway to hell/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /All the small things/ }))
    expect(screen.getByText(/2 ausgewählt/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
    expect(onDone).toHaveBeenCalledWith('Gig', ['a', 'c'])
  })

  it('needs a name; Abbrechen creates nothing', () => {
    const onDone = vi.fn()
    const onCancel = vi.fn()
    render(<NewSetlistDialog songs={songs} onCancel={onCancel} onDone={onDone} />)
    expect(screen.getByRole('button', { name: 'Anlegen' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(onCancel).toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })
})
