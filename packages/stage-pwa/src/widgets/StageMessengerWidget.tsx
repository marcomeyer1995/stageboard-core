import { useState } from 'react'
import { FLASH_PRESETS, sendFlash } from '../lib/flash'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useContentFontSize } from '../lib/useContentFontSize'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import type { ContentFontSizeConfig } from './contentFontSizeConfig'

/**
 * Stage-Messenger (#26): FOH or the musical director flashes a short message onto every tablet
 * ("Noch 5 Minuten", "VAMP", …) - one tap on a preset or a typed text.
 */
export function StageMessengerWidget({ config }: { config: ContentFontSizeConfig }) {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const from = useActiveProfile()?.name
  const fontSize = useContentFontSize(config)
  const [text, setText] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  async function send(message: string) {
    const trimmed = message.trim()
    if (!trimmed) return
    const ok = await sendFlash(workspaceId, trimmed.slice(0, 120), from)
    setStatus(ok ? `Gesendet: „${trimmed}“` : 'Nicht gesendet - Stage-Server nicht erreichbar.')
    if (ok) setText('')
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto text-ink-soft" style={{ fontSize }}>
      <div className="flex flex-wrap gap-2">
        {FLASH_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => void send(preset)}
            className="min-h-12 rounded-sb-sm bg-control-strong px-3 font-bold text-ink hover:bg-control-strong-hover"
          >
            {preset}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void send(text)
        }}
      >
        <input
          value={text}
          maxLength={120}
          onChange={(e) => setText(e.target.value)}
          placeholder="Eigene Nachricht…"
          aria-label="Nachricht an alle"
          className="h-12 min-w-0 flex-1 rounded-sb-sm bg-control px-3 text-ink"
        />
        <button type="submit" disabled={!text.trim()} className="min-h-12 rounded-sb-sm bg-accent px-4 font-bold text-accent-ink disabled:opacity-40">
          Senden
        </button>
      </form>
      {status && (
        <p role="status" className="text-sm text-ink-faint">
          {status}
        </p>
      )}
    </div>
  )
}
