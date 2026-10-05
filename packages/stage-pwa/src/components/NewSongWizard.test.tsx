import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// The import step itself is TabImportOverlay's own business - stand-in that "imports" at once.
vi.mock('./TabImportOverlay', () => ({
  TabImportOverlay: ({ onImport, initialQuery }: { onImport: (data: object) => void; initialQuery?: string }) => (
    <button type="button" data-query={initialQuery} onClick={() => onImport({ chordProContent: '[Am]Line one\nLine two', artist: 'Oasis', key: 'Am', bpm: 87, capo: 2 })}>
      Import bestätigen
    </button>
  ),
}))

const { NewSongWizard } = await import('./NewSongWizard')

describe('NewSongWizard (#182)', () => {
  it('import path: content, artist, key and bpm come from the import, editable before saving', () => {
    const onFinish = vi.fn()
    render(<NewSongWizard onCancel={vi.fn()} onFinish={onFinish} />)
    fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Wonderwall' } })
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))
    fireEvent.click(screen.getByRole('button', { name: /Von Ultimate Guitar importieren/ }))
    // The title from step 1 is the search (Marco).
    expect(screen.getByRole('button', { name: 'Import bestätigen' })).toHaveAttribute('data-query', 'Wonderwall')
    fireEvent.click(screen.getByRole('button', { name: 'Import bestätigen' }))

    expect(screen.getByText(/Schritt 3\/3/)).toBeInTheDocument()
    expect((screen.getByLabelText('BPM') as HTMLInputElement).value).toBe('87')
    fireEvent.change(screen.getByLabelText('BPM'), { target: { value: '88' } })
    fireEvent.click(screen.getByRole('button', { name: 'Song anlegen' }))

    const [song, variant] = onFinish.mock.calls[0]
    expect(song).toMatchObject({ title: 'Wonderwall', artist: 'Oasis', bpm: 88, chordProContent: '[Am]Line one\nLine two' })
    expect(variant).toMatchObject({ songId: song.id, isDefault: true, label: 'Original', key: 'Am', capo: 2, bpm: 88 })
  })

  it('blank path and abandoning: nothing is handed over before the last step', () => {
    const onFinish = vi.fn()
    const onCancel = vi.fn()
    render(<NewSongWizard onCancel={onCancel} onFinish={onFinish} />)
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Neu' } })
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }))
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(onCancel).toHaveBeenCalled()
    expect(onFinish).not.toHaveBeenCalled()
  })

  it('refuses an impossible tempo', () => {
    render(<NewSongWizard onCancel={vi.fn()} onFinish={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))
    fireEvent.click(screen.getByRole('button', { name: /Leer beginnen/ }))
    fireEvent.change(screen.getByLabelText('BPM'), { target: { value: '5' } })
    expect(screen.getByRole('button', { name: 'Song anlegen' })).toBeDisabled()
    expect(screen.getByText(/zwischen 20 und 400/)).toBeInTheDocument()
  })
})
