import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from 'shared-types'

// useProfilesStore transitively imports profilesDb.ts, which constructs a real PouchDB at
// module load time - unavailable under happy-dom (see AppMenu.test.tsx's identical mock).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { useProfilesStore } = await import('../store/useProfilesStore')
const { CommentListEditor } = await import('./CommentListEditor')

function profile(id: string, name: string): Profile {
  return { id, name, stageRoles: [] }
}

beforeEach(() => {
  useProfilesStore.setState({ profiles: [profile('p1', 'Marco'), profile('p2', 'Jamie')] })
})

describe('CommentListEditor (issue #215 follow-up)', () => {
  it('shows an empty-state hint when the song has no comment directives', () => {
    render(<CommentListEditor content={'Intro lyric\nMore lyric'} onChange={vi.fn()} />)
    expect(screen.getByText(/Noch keine Kommentare/)).toBeInTheDocument()
  })

  it('lists every comment directive with its text', () => {
    const content = 'Intro\n{cc4marco: Fret 7}\nLyric\n{cc: For everyone}'
    render(<CommentListEditor content={content} onChange={vi.fn()} />)

    expect(screen.getByDisplayValue('Fret 7')).toBeInTheDocument()
    expect(screen.getByDisplayValue('For everyone')).toBeInTheDocument()
  })

  it('highlights the targeted member(s) and marks an untargeted comment as "for everyone"', () => {
    const content = '{cc4marco: Fret 7}\n{cc: For everyone}'
    render(<CommentListEditor content={content} onChange={vi.fn()} />)

    const marcoChips = screen.getAllByRole('button', { name: 'Marco' })
    expect(marcoChips[0]).toHaveClass('bg-accent')
    expect(screen.getAllByRole('button', { name: 'Jamie' })[0]).not.toHaveClass('bg-accent')
    expect(screen.getByText('(alle, da niemand ausgewählt)')).toBeInTheDocument()
  })

  it('adds a member to an untargeted comment by clicking their chip - patches {cc:} into {cc4Name:}', () => {
    const content = '{cc: Fret 7}'
    const onChange = vi.fn()
    render(<CommentListEditor content={content} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Marco' }))
    expect(onChange).toHaveBeenCalledWith('{cc4Marco: Fret 7}')
  })

  it('removing the last targeted member falls back to {cc:} (everyone)', () => {
    const content = '{cc4Marco: Fret 7}'
    const onChange = vi.fn()
    render(<CommentListEditor content={content} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Marco' }))
    expect(onChange).toHaveBeenCalledWith('{cc: Fret 7}')
  })

  it('supports targeting several members at once', () => {
    const content = '{cc4Marco: Fret 7}'
    const onChange = vi.fn()
    render(<CommentListEditor content={content} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Jamie' }))
    expect(onChange).toHaveBeenCalledWith('{cc4Marco,Jamie: Fret 7}')
  })

  it('edits a comment\'s text in place, preserving its target', () => {
    const content = '{cc4Marco: Fret 7}'
    const onChange = vi.fn()
    render(<CommentListEditor content={content} onChange={onChange} />)

    fireEvent.change(screen.getByDisplayValue('Fret 7'), { target: { value: 'Fret 9' } })
    expect(onChange).toHaveBeenCalledWith('{cc4marco: Fret 9}')
  })

  it('removes a comment\'s directive line entirely, leaving the rest of the song intact', () => {
    const content = 'Intro\n{cc4Marco: Fret 7}\nOutro'
    const onChange = vi.fn()
    render(<CommentListEditor content={content} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }))
    expect(onChange).toHaveBeenCalledWith('Intro\nOutro')
  })

  it('lists tab blocks and narrows one to a member - only its opening directive changes', () => {
    const onChange = vi.fn()
    const content = ['{start_of_tab}', 'e|---5---|', 'B|---3---|', '{end_of_tab}'].join('\n')
    render(<CommentListEditor content={content} onChange={onChange} />)

    expect(screen.getByText('Tab 1')).toBeInTheDocument()
    expect(screen.getByText('(2 Zeilen)')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Marco' })[0])
    expect(onChange).toHaveBeenCalledWith(['{sot4Marco}', 'e|---5---|', 'B|---3---|', '{end_of_tab}'].join('\n'))
  })
})
