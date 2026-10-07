import { useState } from 'react'
import { FLASH_PRESETS, sendFlash } from '../lib/flash'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useContentFontSize } from '../lib/useContentFontSize'
import { useProfilesStore } from '../store/useProfilesStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { Icon } from '../components/Icon'
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

  const chip = (selected: boolean) =>
    `min-h-12 rounded-control px-3 font-semibold ${selected ? 'bg-accent text-accent-ink' : 'bg-control text-ink-soft [@media(hover:hover)]:hover:bg-control-hover'}`

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto text-ink-soft" style={{ fontSize }}>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Empfänger">
        <span className="text-sm text-ink-faint">An</span>
        <button type="button" aria-pressed={to.length === 0} onClick={() => setTo([])} className={chip(to.length === 0)}>
          Alle
        </button>
        {profiles.map((profile) => (
          <button key={profile.id} type="button" aria-pressed={to.includes(profile.id)} onClick={() => toggle(profile.id)} className={chip(to.includes(profile.id))}>
            {profile.name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {presets.map((preset, i) => (
          <button
            key={`${i}-${preset}`}
            type="button"
            onClick={() => void send(preset)}
            className="min-h-12 rounded-control bg-control-strong px-3 font-bold text-ink [@media(hover:hover)]:hover:bg-control-strong-hover"
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
          aria-label={`Nachricht an ${recipients}`}
          className="h-12 min-w-0 flex-1 rounded-control bg-control px-3 text-ink"
        />
        <button type="submit" disabled={!text.trim()} className="min-h-12 rounded-control bg-accent px-4 font-bold text-accent-ink disabled:opacity-40">
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
  const iconButton = 'flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-control bg-control text-ink-soft [@media(hover:hover)]:hover:bg-control-hover disabled:opacity-30'
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
              className="h-12 min-w-0 flex-1 rounded-control bg-control px-3 text-base text-ink"
            />
            <button type="button" aria-label={`„${preset}“ nach oben`} disabled={i === 0} onClick={() => move(i, -1)} className={iconButton}>
              <Icon name="up" />
            </button>
            <button type="button" aria-label={`„${preset}“ nach unten`} disabled={i === presets.length - 1} onClick={() => move(i, 1)} className={iconButton}>
              <Icon name="down" />
            </button>
            <button type="button" aria-label={`„${preset}“ entfernen`} onClick={() => set(presets.filter((_, j) => j !== i))} className={iconButton}>
              <Icon name="close" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={presets.length >= 30} onClick={() => set([...presets, 'Neue Nachricht'])} className="min-h-12 rounded-control bg-accent px-4 font-bold text-accent-ink disabled:opacity-40">
          + Nachricht
        </button>
        {config.presets && (
          <button type="button" onClick={() => onChange({ ...config, presets: undefined })} className="min-h-12 rounded-control bg-control px-4 text-ink-soft [@media(hover:hover)]:hover:bg-control-hover">
            Standard wiederherstellen
          </button>
        )}
      </div>
    </div>
  )
}
