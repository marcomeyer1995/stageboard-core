import { useState } from 'react'
import { type DialogField, useDialogStore } from '../store/useDialogStore'

/**
 * Renders whatever `useDialogStore`'s `request` currently holds - mounted once in App.tsx, so
 * every promptText/promptFields/confirm call anywhere in the app shows up here. See
 * useDialogStore.ts for why this replaces window.prompt()/window.confirm().
 */
export function DialogHost() {
  const request = useDialogStore((state) => state.request)
  const submit = useDialogStore((state) => state.submit)
  const acceptConfirm = useDialogStore((state) => state.acceptConfirm)
  const acceptAlert = useDialogStore((state) => state.acceptAlert)
  const cancel = useDialogStore((state) => state.cancel)

  if (!request) return null

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/60 p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancel()
      }}
    >
      <div className="max-h-[90vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-sb border border-line bg-surface p-6 text-ink">
        <h2 className="text-lg font-bold">{request.title}</h2>

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
        field.type === 'checkboxes' ? (
          <fieldset key={field.key} className="text-sm">
            <legend className="mb-1 text-ink-muted">{field.label}</legend>
            <div className="flex flex-col gap-1">
              {(field.options ?? []).map((option) => {
                const selected = values[field.key].split(',').filter(Boolean)
                const checked = selected.includes(option.value)
                return (
                  <label key={option.value} className="flex items-center gap-2 text-ink-soft">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setValues((prev) => {
                          const current = prev[field.key].split(',').filter(Boolean)
                          const next = checked
                            ? current.filter((v) => v !== option.value)
                            : [...current, option.value]
                          return { ...prev, [field.key]: next.join(',') }
                        })
                      }
                      className="h-5 w-5"
                    />
                    {option.label}
                  </label>
                )
              })}
            </div>
          </fieldset>
        ) : (
          <label key={field.key} className="block text-sm">
            <span className="mb-1 block text-ink-muted">{field.label}</span>
            <input
              autoFocus={index === 0}
              type={field.type ?? 'text'}
              value={values[field.key]}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              className="h-12 w-full rounded-sb bg-control px-3 text-ink-soft"
            />
          </label>
        ),
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-sb bg-control px-4 py-2 font-semibold text-ink-soft hover:bg-control-hover"
        >
          Abbrechen
        </button>
        <button type="submit" className="rounded-sb bg-accent px-4 py-2 font-semibold text-accent-ink">
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

function AlertBody({ message, onAcknowledge }: { message?: string; onAcknowledge: () => void }) {
  return (
    <div className="space-y-3">
      {message && <p className="text-sm text-ink-muted">{message}</p>}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={onAcknowledge}
          className="rounded-sb bg-accent px-4 py-2 font-semibold text-accent-ink"
        >
          OK
        </button>
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
      {message && <p className="text-sm text-ink-muted">{message}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-sb bg-control px-4 py-2 font-semibold text-ink-soft hover:bg-control-hover"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`rounded-sb px-4 py-2 font-semibold ${
            danger ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-accent text-accent-ink'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}
