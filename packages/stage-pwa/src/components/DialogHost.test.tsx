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

  it('found live, 2026-09-10: a \'pin\' field steers touch keyboards to digits-only instead of a full keyboard', async () => {
    render(<DialogHost />)
    act(() => {
      void useDialogStore.getState().promptFields('Eigenen PIN setzen', [{ key: 'pin', label: 'Neuer 4-stelliger PIN', type: 'pin' }])
    })

    const pinInput = screen.getByLabelText('Neuer 4-stelliger PIN') as HTMLInputElement
    expect(pinInput.inputMode).toBe('numeric')
    expect(pinInput.pattern).toBe('[0-9]*')
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

describe('DialogHost - destructive confirmation (#361)', () => {
  const options = { title: '„Abadschendaler" für alle löschen?', message: 'Alles weg.', typeToConfirm: 'Abadschendaler', confirmLabel: 'Für alle löschen', alternativeLabel: 'Nur von diesem Gerät entfernen' }

  it('the delete button only works once the name is typed (spaces and case ignored)', async () => {
    render(<DialogHost />)
    let result: Promise<'confirm' | 'alternative' | null>
    act(() => {
      result = useDialogStore.getState().confirmDestructive(options)
    })
    const button = screen.getByRole('button', { name: 'Für alle löschen' })
    expect(button).toBeDisabled()
    const input = screen.getByLabelText('Zum Bestätigen „Abadschendaler“ eingeben')
    fireEvent.change(input, { target: { value: 'Abadschen' } })
    expect(button).toBeDisabled()
    fireEvent.change(input, { target: { value: '  abadschendaler ' } })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await expect(result!).resolves.toBe('confirm')
  })

  it('offers the harmless alternative in one tap, and cancelling resolves null', async () => {
    render(<DialogHost />)
    let result: Promise<'confirm' | 'alternative' | null>
    act(() => {
      result = useDialogStore.getState().confirmDestructive(options)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Nur von diesem Gerät entfernen' }))
    await expect(result!).resolves.toBe('alternative')

    act(() => {
      result = useDialogStore.getState().confirmDestructive(options)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    await expect(result!).resolves.toBeNull()
  })

  it('sits above the burger menu and other overlays (#375: Force Takeover opened behind the menu)', () => {
    render(<DialogHost />)
    act(() => {
      void useDialogStore.getState().confirm('Ein anderes Gerät ist Master.', { title: 'Master übernehmen?' })
    })
    const host = screen.getByTestId('dialog-host')
    // AppMenu / OverflowMenu / WidgetFrame menus use z-40, DeviceSetupWizard and nested sheets z-50.
    expect(host.className).toContain('z-[55]')
    expect(host.className).not.toMatch(/\bz-(30|40|50)\b/)
  })

  it('covers only the visible area, so an on-screen keyboard cannot hide the dialog (#375)', () => {
    const listeners: Record<string, () => void> = {}
    const vv = {
      offsetTop: 0,
      height: 800,
      addEventListener: (type: string, fn: () => void) => {
        listeners[type] = fn
      },
      removeEventListener: () => {},
    }
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
    try {
      render(<DialogHost />)
      act(() => {
        void useDialogStore.getState().promptText('Neue Setlist')
      })
      expect(screen.getByTestId('dialog-host').style.height).toBe('800px')

      // Keyboard opens: the visible area shrinks to 420 px.
      act(() => {
        vv.height = 420
        listeners.resize()
      })
      expect(screen.getByTestId('dialog-host').style.height).toBe('420px')
      expect(screen.getByTestId('dialog-host').style.top).toBe('0px')
    } finally {
      Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true })
    }
  })
})

