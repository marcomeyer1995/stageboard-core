import { beforeEach, describe, expect, it } from 'vitest'
import { useDialogStore } from './useDialogStore'

beforeEach(() => {
  useDialogStore.setState({ request: null })
})

describe('promptFields / submit / cancel', () => {
  it('resolves with the submitted values', async () => {
    const promise = useDialogStore.getState().promptFields('Title', [{ key: 'name', label: 'Name' }])
    expect(useDialogStore.getState().request?.kind).toBe('prompt')

    useDialogStore.getState().submit({ name: 'Marco' })

    expect(await promise).toEqual({ name: 'Marco' })
    expect(useDialogStore.getState().request).toBeNull()
  })

  it('resolves null on cancel', async () => {
    const promise = useDialogStore.getState().promptFields('Title', [{ key: 'name', label: 'Name' }])
    useDialogStore.getState().cancel()
    expect(await promise).toBeNull()
  })
})

describe('promptText', () => {
  it('resolves with just the single field value', async () => {
    const promise = useDialogStore.getState().promptText('Neue Band', { label: 'Name der neuen Band' })
    const request = useDialogStore.getState().request
    expect(request?.kind).toBe('prompt')
    if (request?.kind !== 'prompt') throw new Error('expected a prompt request')
    expect(request.fields).toEqual([{ key: 'value', label: 'Name der neuen Band', defaultValue: undefined }])

    useDialogStore.getState().submit({ value: 'Band C' })

    expect(await promise).toBe('Band C')
  })

  it('resolves null on cancel', async () => {
    const promise = useDialogStore.getState().promptText('Neue Band')
    useDialogStore.getState().cancel()
    expect(await promise).toBeNull()
  })
})

describe('confirm / acceptConfirm / cancel', () => {
  it('resolves true when accepted', async () => {
    const promise = useDialogStore.getState().confirm('Wirklich löschen?', { confirmLabel: 'Löschen', danger: true })
    const request = useDialogStore.getState().request
    expect(request?.kind).toBe('confirm')
    if (request?.kind !== 'confirm') throw new Error('expected a confirm request')
    expect(request.confirmLabel).toBe('Löschen')
    expect(request.danger).toBe(true)

    useDialogStore.getState().acceptConfirm()

    expect(await promise).toBe(true)
  })

  it('resolves false on cancel', async () => {
    const promise = useDialogStore.getState().confirm('Wirklich löschen?')
    useDialogStore.getState().cancel()
    expect(await promise).toBe(false)
  })

  it('acceptConfirm is a no-op if the current request is a prompt, not a confirm', async () => {
    const promise = useDialogStore.getState().promptFields('Title', [{ key: 'a', label: 'A' }])
    useDialogStore.getState().acceptConfirm()
    // Request should still be the pending prompt, untouched.
    expect(useDialogStore.getState().request?.kind).toBe('prompt')
    useDialogStore.getState().cancel()
    expect(await promise).toBeNull()
  })
})

describe('alert / acceptAlert / cancel', () => {
  it('resolves (with no value) when acknowledged', async () => {
    const promise = useDialogStore.getState().alert('Stage-Server nicht erreichbar.')
    const request = useDialogStore.getState().request
    expect(request?.kind).toBe('alert')
    if (request?.kind !== 'alert') throw new Error('expected an alert request')
    expect(request.title).toBe('Stage-Server nicht erreichbar.')

    useDialogStore.getState().acceptAlert()

    expect(await promise).toBeUndefined()
    expect(useDialogStore.getState().request).toBeNull()
  })

  it('also resolves on cancel (Escape) - an alert has only one way out', async () => {
    const promise = useDialogStore.getState().alert('Etwas ist schiefgelaufen.')
    useDialogStore.getState().cancel()
    expect(await promise).toBeUndefined()
  })
})
