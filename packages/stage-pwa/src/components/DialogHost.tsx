import { useState } from 'react'
import { type DialogField, useDialogStore } from '../store/useDialogStore'
import { useBackHandler } from '../lib/backNavigation'
import { useVisualViewport } from '../lib/useVisualViewport'
import { Button, CheckRow, MENU_ROW } from './ui'
import { INPUT, SELECTED } from './ui/styles'

/**
 * Renders whatever `useDialogStore`'s `request` currently holds - mounted once in App.tsx, so
 * every promptText/promptFields/confirm call anywhere in the app shows up here. See
 * useDialogStore.ts for why this replaces window.prompt()/window.confirm().
 *
 * Stacking (#375): a dialog is always the answer to something the user just did - often inside
 * another overlay (the burger menu's "Force Takeover", a widget's or row's ⋯ menu). It therefore
 * sits above every menu/sheet layer (those use z-40/z-50); only the AudioResumeOverlay (z-60),
 * which blocks the whole app until audio is unlocked, stays above it.
 *
 * Keyboard: a dialog the user types into opens at the top of the screen, where the on-screen
 * keyboard (which comes from below) can't cover its field or buttons. Centring it in the visual
 * viewport alone is not enough: Silk/Chrome in fullscreen mode (Fire tablet, GUI check
 * 2026-10-04) report the full 800 px height with the keyboard open, and the VirtualKeyboard API
 * reports nothing there either. Where the browser does shrink the visual viewport, the overlay
 * follows it as well.
 */
/** Whether the dialog asks for typed input - those open at the top (see DialogHost). */
function typesText(request: NonNullable<ReturnType<typeof useDialogStore.getState>['request']>): boolean {
  return request.kind === 'prompt' || request.kind === 'destructive'
}

export function DialogHost() {
  const request = useDialogStore((state) => state.request)
  const submit = useDialogStore((state) => state.submit)
  const acceptConfirm = useDialogStore((state) => state.acceptConfirm)
  const acceptAlert = useDialogStore((state) => state.acceptAlert)
  const cancel = useDialogStore((state) => state.cancel)
  const resolveDestructive = useDialogStore((state) => state.resolveDestructive)
  useBackHandler(request ? cancel : null)
  const visible = useVisualViewport()

  if (!request) return null

  return (
    <div
      role="presentation"
      data-testid="dialog-host"
      className={`fixed inset-x-0 top-0 z-[55] flex h-dvh justify-center overflow-y-auto bg-black/60 p-4 ${
        typesText(request) ? 'items-start pt-6' : 'items-center'
      }`}
      style={visible ? { top: visible.offsetTop, height: visible.height } : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancel()
      }}
    >
      <div className="max-h-full w-full max-w-sm space-y-4 overflow-y-auto rounded-container border border-line bg-surface p-4 text-ink shadow-sb">
        <h2 className="border-b border-line pb-3 text-lg font-bold">{request.title}</h2>

        {request.kind === 'prompt' && (
          <PromptFields fields={request.fields} submitLabel={request.submitLabel} onSubmit={submit} onCancel={cancel} />
        )}
        {request.kind === 'confirm' && (
          <ConfirmBody
            message={request.message}
            confirmLabel={request.confirmLabel}
            danger={request.danger}
            onConfirm={acceptConfirm}
            onCancel={cancel}
          />
        )}
        {request.kind === 'destructive' && (
          <DestructiveBody
            key={request.typeToConfirm}
            message={request.message}
            typeToConfirm={request.typeToConfirm}
            confirmLabel={request.confirmLabel}
            alternativeLabel={request.alternativeLabel}
            onResolve={resolveDestructive}
            onCancel={cancel}
          />
        )}
        {request.kind === 'alert' && <AlertBody message={request.message} onAcknowledge={acceptAlert} />}
      </div>
    </div>
  )
}

function PromptFields({
  fields,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  fields: DialogField[]
  submitLabel: string
  onSubmit: (value: Record<string, string>) => void
  onCancel: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, field.defaultValue ?? ''])),
  )

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(values)
      }}
      className="space-y-3"
    >
      {fields.map((field, index) =>
        field.type === 'radio' ? (
          <fieldset key={field.key} className="text-sm">
            <legend className="mb-1 font-semibold text-ink-soft">{field.label}</legend>
            {/* Pick one (docs/15 D7): full-width rows, the chosen one yellow. */}
            <div className="flex flex-col gap-1" role="radiogroup" aria-label={field.label}>
              {(field.options ?? []).map((option, optionIndex) => {
                const chosen = values[field.key] === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    autoFocus={index === 0 && optionIndex === 0}
                    onClick={() => setValues((prev) => ({ ...prev, [field.key]: option.value }))}
                    className={`${MENU_ROW} ${chosen ? SELECTED : 'text-ink-soft'}`}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </fieldset>
        ) : field.type === 'checkboxes' ? (
          <fieldset key={field.key} className="text-sm">
            <legend className="mb-1 font-semibold text-ink-soft">{field.label}</legend>
            <div className="flex flex-col gap-1">
              {(field.options ?? []).map((option) => {
                const selected = values[field.key].split(',').filter(Boolean)
                const checked = selected.includes(option.value)
                return (
                  <CheckRow
                    key={option.value}
                    checked={checked}
                    onToggle={() =>
                      setValues((prev) => {
                        const current = prev[field.key].split(',').filter(Boolean)
                        const next = checked ? current.filter((v) => v !== option.value) : [...current, option.value]
                        return { ...prev, [field.key]: next.join(',') }
                      })
                    }
                  >
                    {option.label}
                  </CheckRow>
                )
              })}
            </div>
          </fieldset>
        ) : field.type === 'textarea' ? (
          <label key={field.key} className="block text-sm">
            <span className="mb-1 block font-semibold text-ink-soft">{field.label}</span>
            <textarea
              autoFocus={index === 0}
              rows={5}
              value={values[field.key]}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              className={`resize-y px-4 py-2 text-base ${INPUT}`}
            />
          </label>
        ) : (
          <label key={field.key} className="block text-sm">
            <span className="mb-1 block font-semibold text-ink-soft">{field.label}</span>
            <input
              autoFocus={index === 0}
              // 'pin' isn't a real HTML input type - falls back to a plain text box, but with
              // inputMode/pattern still steering touch keyboards to digits-only (found live,
              // 2026-09-10: a bare 'text' box brought up the full keyboard for a 4-digit PIN).
              type={field.type === 'pin' ? 'text' : (field.type ?? 'text')}
              inputMode={field.type === 'pin' ? 'numeric' : undefined}
              pattern={field.type === 'pin' ? '[0-9]*' : undefined}
              value={values[field.key]}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              className={`h-form px-4 text-lg ${INPUT}`}
            />
          </label>
        ),
      )}
      <div className="flex justify-between gap-2 border-t border-line pt-3">
        <Button onClick={onCancel}>Abbrechen</Button>
        <Button type="submit" variant="primary">
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

function AlertBody({ message, onAcknowledge }: { message?: string; onAcknowledge: () => void }) {
  return (
    <div className="space-y-3">
      {message && <p className="whitespace-pre-line text-base text-ink-soft">{message}</p>}
      <div className="flex justify-end border-t border-line pt-3">
        <Button variant="primary" onClick={onAcknowledge}>
          OK
        </Button>
      </div>
    </div>
  )
}

function ConfirmBody({
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  message?: string
  confirmLabel: string
  danger: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="space-y-3">
      {message && <p className="whitespace-pre-line text-base text-ink-soft">{message}</p>}
      <div className="flex justify-between gap-2 border-t border-line pt-3">
        <Button onClick={onCancel}>Abbrechen</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  )
}

/** Typing the name is the confirmation (#361): the destructive button stays disabled until the
 * text matches (ignoring surrounding spaces and case); the harmless alternative is one tap. */
function DestructiveBody({
  message,
  typeToConfirm,
  confirmLabel,
  alternativeLabel,
  onResolve,
  onCancel,
}: {
  message: string
  typeToConfirm: string
  confirmLabel: string
  alternativeLabel?: string
  onResolve: (value: 'confirm' | 'alternative') => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const matches = typed.trim().toLowerCase() === typeToConfirm.trim().toLowerCase()
  return (
    <div className="space-y-3">
      <p className="text-base text-ink-muted">{message}</p>
      {alternativeLabel && (
        <Button variant="primary" fullWidth onClick={() => onResolve('alternative')}>
          {alternativeLabel}
        </Button>
      )}
      <label className="flex flex-col gap-1 text-sm font-semibold text-ink-soft">
        Zum Bestätigen „{typeToConfirm}“ eingeben
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          className={`h-form px-4 text-base font-normal ${INPUT}`}
          aria-label={`Zum Bestätigen „${typeToConfirm}“ eingeben`}
        />
      </label>
      <div className="flex justify-between gap-2 border-t border-line pt-3">
        <Button onClick={onCancel}>Abbrechen</Button>
        <Button variant="danger" disabled={!matches} onClick={() => onResolve('confirm')}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  )
}

