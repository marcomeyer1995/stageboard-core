import { create } from 'zustand'

export interface DialogField {
  key: string
  label: string
  defaultValue?: string
  type?: 'text' | 'password' | 'checkboxes'
  /** Only used when type is 'checkboxes' - one checkbox per option. The field still resolves
   * through the same Record<string, string> as every other field: selected values end up
   * comma-joined in a single string, so promptFields()'s return type doesn't need to widen. */
  options?: { value: string; label: string }[]
}

interface PromptRequest {
  kind: 'prompt'
  title: string
  fields: DialogField[]
  submitLabel: string
  resolve: (value: Record<string, string> | null) => void
}

interface ConfirmRequest {
  kind: 'confirm'
  title: string
  message?: string
  confirmLabel: string
  danger: boolean
  resolve: (value: boolean) => void
}

interface AlertRequest {
  kind: 'alert'
  title: string
  message?: string
  resolve: () => void
}

interface DialogState {
  request: PromptRequest | ConfirmRequest | AlertRequest | null
  promptFields: (title: string, fields: DialogField[], submitLabel?: string) => Promise<Record<string, string> | null>
  promptText: (
    title: string,
    options?: { label?: string; defaultValue?: string; submitLabel?: string },
  ) => Promise<string | null>
  confirm: (message: string, options?: { title?: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>
  alert: (message: string, options?: { title?: string }) => Promise<void>
  submit: (value: Record<string, string>) => void
  acceptConfirm: () => void
  acceptAlert: () => void
  cancel: () => void
}

/**
 * In-app replacement for window.prompt()/window.confirm()/window.alert() (see #12 follow-up,
 * 2026-08-30) - those are unreliable inside a Capacitor-wrapped native app (iOS's WKWebView in
 * particular doesn't bridge window.prompt() by default), block the page's JS thread outright
 * (confirmed live: a leftover window.alert() in a Zustand store's fetch-error path froze the
 * tab), and look out of place even in a plain installed PWA. `DialogHost.tsx` (mounted once in
 * App.tsx) renders whatever `request` currently holds; every call site awaits a Promise exactly
 * like the browser APIs they replace, so converting a call site is a small, mechanical diff
 * rather than a rewrite. Store code (no React hooks available) calls `useDialogStore.getState()`
 * directly instead of the hook form components use.
 */
export const useDialogStore = create<DialogState>()((set, get) => ({
  request: null,
  promptFields: (title, fields, submitLabel = 'OK') =>
    new Promise((resolve) => {
      set({ request: { kind: 'prompt', title, fields, submitLabel, resolve } })
    }),
  promptText: (title, options = {}) =>
    get()
      .promptFields(
        title,
        [{ key: 'value', label: options.label ?? title, defaultValue: options.defaultValue }],
        options.submitLabel,
      )
      .then((result) => result?.value ?? null),
  confirm: (message, options = {}) =>
    new Promise((resolve) => {
      set({
        request: {
          kind: 'confirm',
          title: options.title ?? message,
          message: options.title ? message : undefined,
          confirmLabel: options.confirmLabel ?? 'OK',
          danger: options.danger ?? false,
          resolve,
        },
      })
    }),
  alert: (message, options = {}) =>
    new Promise((resolve) => {
      set({
        request: {
          kind: 'alert',
          title: options.title ?? message,
          message: options.title ? message : undefined,
          resolve,
        },
      })
    }),
  submit: (value) => {
    const request = get().request
    if (request?.kind !== 'prompt') return
    request.resolve(value)
    set({ request: null })
  },
  acceptConfirm: () => {
    const request = get().request
    if (request?.kind !== 'confirm') return
    request.resolve(true)
    set({ request: null })
  },
  acceptAlert: () => {
    const request = get().request
    if (request?.kind !== 'alert') return
    request.resolve()
    set({ request: null })
  },
  cancel: () => {
    const request = get().request
    if (!request) return
    if (request.kind === 'prompt') {
      request.resolve(null)
    } else if (request.kind === 'confirm') {
      request.resolve(false)
    } else {
      request.resolve()
    }
    set({ request: null })
  },
}))
