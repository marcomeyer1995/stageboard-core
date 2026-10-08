import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDialogStore } from '../store/useDialogStore'
import { confirmLeave, hasUnsavedChanges, useUnsavedChangesGuard } from './unsavedChanges'

const realAskUnsaved = useDialogStore.getState().askUnsaved

function Editor({ dirty, save }: { dirty: boolean; save: () => Promise<boolean> }) {
  useUnsavedChangesGuard(dirty, save)
  return null
}

describe('unsaved changes guard - never lose edits silently', () => {
  it('nothing unsaved: leaving needs no question', async () => {
    const askUnsaved = vi.fn(async () => null)
    useDialogStore.setState({ askUnsaved })
    render(<Editor dirty={false} save={async () => true} />)
    expect(hasUnsavedChanges()).toBe(false)
    expect(await confirmLeave()).toBe(true)
    expect(askUnsaved).not.toHaveBeenCalled()
  })

  it('Speichern saves and leaves; a failed save stays; Verwerfen leaves; Weiter bearbeiten stays', async () => {
    const save = vi.fn(async () => true)
    const { rerender, unmount } = render(<Editor dirty save={save} />)
    expect(hasUnsavedChanges()).toBe(true)

    useDialogStore.setState({ askUnsaved: async () => 'save' })
    expect(await confirmLeave()).toBe(true)
    expect(save).toHaveBeenCalled()

    rerender(<Editor dirty save={async () => false} />)
    expect(await confirmLeave()).toBe(false)

    useDialogStore.setState({ askUnsaved: async () => 'discard' })
    expect(await confirmLeave()).toBe(true)
    useDialogStore.setState({ askUnsaved: async () => null })
    expect(await confirmLeave()).toBe(false)

    unmount()
    expect(hasUnsavedChanges()).toBe(false)
  })

  it('the question offers Speichern, Verwerfen and Weiter bearbeiten', async () => {
    const { DialogHost } = await import('../components/DialogHost')
    useDialogStore.setState({ askUnsaved: realAskUnsaved })
    const { getByRole, findByRole } = render(<DialogHost />)
    void useDialogStore.getState().askUnsaved()
    expect(await findByRole('button', { name: 'Speichern' })).toBeInTheDocument()
    expect(getByRole('button', { name: 'Verwerfen' })).toBeInTheDocument()
    expect(getByRole('button', { name: 'Weiter bearbeiten' })).toBeInTheDocument()
  })
})
