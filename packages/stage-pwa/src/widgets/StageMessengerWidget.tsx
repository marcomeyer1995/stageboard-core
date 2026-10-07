import { Button, IconButton, ToggleChip } from '../components/ui'
import { INPUT } from '../components/ui/styles'
import { useState } from 'react'
import { FLASH_PRESETS, sendFlash } from '../lib/flash'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useContentFontSize } from '../lib/useContentFontSize'
import { useProfilesStore } from '../store/useProfilesStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { ContentFontSizeConfigPanel } from './ContentFontSizeConfigPanel'
import type { StageMessengerConfig } from './stageMessengerConfig'

/**
 * Stage-Messenger (#26): FOH or the musical director flashes a short message onto the band's
 * tablets ("Noch 5 Minuten", "VAMP", …) - to everyone, or only to the people picked under "An"
 * ("Gitarre stimmen" only for the guitarist). One tap on a quick message or a typed text; the
 * quick messages are this widget's own (⋯ → Einstellungen).
 */
export function StageMessengerWidget({ config }: { config: StageMessengerConfig }) {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const workspace = useWorkspaceStore((state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId))
  const profiles = useProfilesStore((state) => state.profiles)
  const from = useActiveProfile()?.name
  const fontSize = useContentFontSize(config)
  const presets = config.presets ?? FLASH_PRESETS
  const [to, setTo] = useState<string[]>([])
  const [text, setText] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  const recipients = to.length ? profiles.filter((p) => to.includes(p.id)).map((p) => p.name).join(', ') : 'alle'
  const toggle = (id: string) => setTo((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))

  async function send(message: string) {
    const trimmed = message.trim()
    if (!trimmed) return
    const result = await sendFlash(workspaceId, trimmed.slice(0, 120), from, { username: workspace?.username, password: workspace?.couchPassword }, to)
    setStatus(
      result === 'sent'
        ? `An ${recipients} gesendet: „${trimmed}“`
        : result === 'not-signed-in'
          ? 'Nicht gesendet - dieses Gerät ist nicht bei der Band angemeldet.'
          : 'Nicht gesendet - Stage-Server nicht erreichbar.',
    )
    if (result === 'sent') setText('')
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto text-ink-soft" style={{ fontSize }}>
      {/* Pick several (docs/15 D7); "Alle" stays its own first chip that clears the others. */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Empfänger">
        <span className="text-sm text-ink-faint">An</span>
        <ToggleChip size="widget" label="Alle" selected={to.length === 0} onToggle={() => setTo([])} />
        {profiles.map((profile) => (
          <ToggleChip key={profile.id} size="widget" label={profile.name} selected={to.includes(profile.id)} onToggle={() => toggle(profile.id)} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {presets.map((preset, i) => (
          <Button key={`${i}-${preset}`} size="widget" onClick={() => void send(preset)} className="font-bold">
            {preset}
          </Button>
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
          aria-label={`Nachricht an ${recipients}`}
          className={`h-form min-w-0 flex-1 px-3 ${INPUT}`}
        />
        <Button type="submit" variant="primary" size="widget" disabled={!text.trim()}>
          Senden
        </Button>
      </form>
      {status && (
        <p role="status" className="text-sm text-ink-faint">
          {status}
        </p>
      )}
    </div>
  )
}

/** ⋯ → Einstellungen: text size and the quick messages - change, add, remove, reorder. */
export function StageMessengerConfigPanel({ config, onChange }: { config: StageMessengerConfig; onChange: (next: StageMessengerConfig) => void }) {
  const presets = config.presets ?? FLASH_PRESETS
  const set = (next: string[]) => onChange({ ...config, presets: next })
  const move = (i: number, by: number) => {
    const next = [...presets]
    const [item] = next.splice(i, 1)
    next.splice(i + by, 0, item!)
    set(next)
  }
  return (
    <div className="flex flex-col gap-3">
      <ContentFontSizeConfigPanel config={config} onChange={onChange} />
      <p className="text-base font-semibold text-ink">Schnellnachrichten</p>
      <ul className="flex flex-col gap-2" aria-label="Schnellnachrichten">
        {presets.map((preset, i) => (
          <li key={i} className="flex items-center gap-2">
            <input
              value={preset}
              maxLength={120}
              aria-label={`Nachricht ${i + 1}`}
              onChange={(e) => set(presets.map((p, j) => (j === i ? e.target.value : p)))}
              onBlur={() => set(presets.map((p) => p.trim()).filter(Boolean))}
              className={`h-form min-w-0 flex-1 px-3 text-base ${INPUT}`}
            />
            <IconButton icon="up" label={`„${preset}“ nach oben`} disabled={i === 0} onClick={() => move(i, -1)} />
            <IconButton icon="down" label={`„${preset}“ nach unten`} disabled={i === presets.length - 1} onClick={() => move(i, 1)} />
            <IconButton icon="close" variant="quiet" label={`„${preset}“ entfernen`} onClick={() => set(presets.filter((_, j) => j !== i))} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button icon="add" disabled={presets.length >= 30} onClick={() => set([...presets, 'Neue Nachricht'])}>
          Nachricht
        </Button>
        {config.presets && (
          <Button variant="quiet" onClick={() => onChange({ ...config, presets: undefined })}>
            Standard wiederherstellen
          </Button>
        )}
      </div>
    </div>
  )
}
