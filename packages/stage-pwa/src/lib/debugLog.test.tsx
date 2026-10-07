import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DebugConsoleView } from '../components/DebugConsoleView'
import { entriesAsText, formatArg, installConsoleCapture, LOG_CAPACITY, useDebugLogStore } from './debugLog'

beforeEach(() => {
  useDebugLogStore.getState().clear()
  localStorage.removeItem('sb:debug:grid')
})

describe('debug log (#14)', () => {
  it('keeps the newest entries up to its capacity', () => {
    for (let i = 0; i < LOG_CAPACITY + 20; i++) useDebugLogStore.getState().add('info', `line ${i}`)
    const entries = useDebugLogStore.getState().entries
    expect(entries).toHaveLength(LOG_CAPACITY)
    expect(entries[0]!.text).toBe('line 20')
    expect(entries[entries.length - 1]!.text).toBe(`line ${LOG_CAPACITY + 19}`)
  })

  it('mirrors console output into the log, the console itself unchanged', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    installConsoleCapture()
    console.error('Sync failed', { status: 401 }, new Error('boom'))
    const all = useDebugLogStore.getState().entries
    const last = all[all.length - 1]!
    expect(last).toMatchObject({ level: 'error', text: 'Sync failed {"status":401} Error: boom' })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('formats arguments and exports plain text', () => {
    expect(formatArg('x')).toBe('x')
    expect(formatArg({ a: 1 })).toBe('{"a":1}')
    expect(formatArg('y'.repeat(10))).toBe('yyyyyyyyyy')
    // A big logged document is cut while serializing (long strings, long arrays).
    const doc = { chordPro: 'x'.repeat(100_000), bars: Array.from({ length: 1000 }, (_, i) => i) }
    const text = formatArg(doc)
    expect(text.length).toBeLessThanOrEqual(501)
    expect(text).toContain('…')
    expect(formatArg({ list: Array.from({ length: 25 }, () => 1) })).toContain('"… +5"')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(formatArg(circular)).toBe('[object Object]')
    expect(entriesAsText([{ id: 1, at: Date.UTC(2026, 9, 5, 7, 3, 4, 5), level: 'warn', text: 'Hm' }])).toBe('07:03:04.005 WARN  Hm')
  })
})

describe('DebugConsoleView (#14)', () => {
  it('shows entries newest first, filters by level and text, clears', () => {
    const { add } = useDebugLogStore.getState()
    add('info', 'Song geladen')
    add('error', 'Sync-Fehler 401')
    add('warn', 'Langsame Antwort')
    render(<DebugConsoleView />)
    const items = () => screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items()[0]).toContain('Langsame Antwort')
    fireEvent.click(screen.getByRole('radio', { name: /^Fehler/ }))
    expect(items()).toHaveLength(1)
    expect(items()[0]).toContain('Sync-Fehler 401')
    fireEvent.click(screen.getByRole('radio', { name: 'Alles' }))
    fireEvent.change(screen.getByLabelText('Log durchsuchen'), { target: { value: 'song' } })
    expect(items()).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Leeren' }))
    expect(screen.getByText('Keine Einträge.')).toBeInTheDocument()
  })

  it('detail-log switches set the localStorage flags the debug helpers read', () => {
    render(<DebugConsoleView />)
    fireEvent.click(screen.getByRole('switch', { name: /Dashboard-Raster/ }))
    expect(localStorage.getItem('sb:debug:grid')).toBe('1')
    fireEvent.click(screen.getByRole('switch', { name: /Dashboard-Raster/ }))
    expect(localStorage.getItem('sb:debug:grid')).toBeNull()
  })
})
