import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useDialogStore } from '../store/useDialogStore'
import { DialogHost } from './DialogHost'

beforeEach(() => {
  useDialogStore.setState({ request: null })
})

describe('DialogHost', () => {
  it('renders nothing when there is no pending request', () => {
    const { container } = render(<DialogHost />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a prompt with its fields, pre-filled from defaultValue, and submits the typed values', async () => {
    render(<DialogHost />)
    let promise!: Promise<Record<string, string> | null>
    act(() => {
      promise = useDialogStore.getState().promptFields('Profil bearbeiten', [
        { key: 'name', label: 'Name', defaultValue: 'Marco' },
        { key: 'role', label: 'Rolle', defaultValue: 'Gitarre' },
      ])
    })

    expect(screen.getByText('Profil bearbeiten')).toBeInTheDocument()
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement
    expect(nameInput.value).toBe('Marco')

    fireEvent.change(nameInput, { target: { value: 'Marco M.' } })
    fireEvent.click(screen.getByText('OK'))

    expect(await promise).toEqual({ name: 'Marco M.', role: 'Gitarre' })
  })

  it('renders a checkboxes field pre-checked from a comma-joined defaultValue, and submits the toggled selection', async () => {
    render(<DialogHost />)
    let promise!: Promise<Record<string, string> | null>
    act(() => {
      promise = useDialogStore.getState().promptFields('Rollen anpassen', [
        {
          key: 'stageRoles',
          label: 'Rollen',
          type: 'checkboxes',
          options: [
            { value: 'performer', label: 'Musiker:in' },
            { value: 'lighttech', label: 'Lichttechnik' },
            { value: 'soundtech', label: 'Tontechnik' },
          ],
          defaultValue: 'performer',
        },
      ])
    })

    const performer = screen.getByLabelText('Musiker:in') as HTMLInputElement
    const soundtech = screen.getByLabelText('Tontechnik') as HTMLInputElement
    expect(performer.checked).toBe(true)
    expect(soundtech.checked).toBe(false)

    fireEvent.click(soundtech)
    fireEvent.click(performer)
    fireEvent.click(screen.getByText('OK'))

    expect(await promise).toEqual({ stageRoles: 'soundtech' })
  })

  it('cancelling a prompt resolves null', async () => {
    render(<DialogHost />)
    let promise!: Promise<string | null>
    act(() => {
      promise = useDialogStore.getState().promptText('Neue Band')
    })
    fireEvent.click(screen.getByText('Abbrechen'))
    expect(await promise).toBeNull()
  })

  it('renders a confirm dialog and resolves true on accept', async () => {
    render(<DialogHost />)
    let promise!: Promise<boolean>
    act(() => {
      promise = useDialogStore.getState().confirm('Wirklich löschen?', { confirmLabel: 'Löschen' })
    })

    expect(screen.getByText('Wirklich löschen?')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Löschen'))

    expect(await promise).toBe(true)
  })

  it('cancelling a confirm resolves false', async () => {
    render(<DialogHost />)
    let promise!: Promise<boolean>
    act(() => {
      promise = useDialogStore.getState().confirm('Wirklich löschen?')
    })
    fireEvent.click(screen.getByText('Abbrechen'))
    expect(await promise).toBe(false)
  })

  it('renders an alert with a single OK button and resolves on acknowledge', async () => {
    render(<DialogHost />)
    let promise!: Promise<void>
    act(() => {
      promise = useDialogStore.getState().alert('Stage-Server nicht erreichbar.')
    })

    expect(screen.getByText('Stage-Server nicht erreichbar.')).toBeInTheDocument()
    expect(screen.queryByText('Abbrechen')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('OK'))

    expect(await promise).toBeUndefined()
  })
})
