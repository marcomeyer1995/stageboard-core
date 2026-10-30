import { useState } from 'react'
import { PLAYBACK_CUE_TARGET, type LogicalDevice, type ShowCue } from 'shared-types'
import { commandsFor, fieldAnswered, fieldOptions, payloadFromAnswers } from '../../lib/deviceCommands'
import { parseCuePayload } from '../../lib/timelineCues'
import { playbackCueContent, playbackSwitches, type FadeUnit, type Switch, type TrackLevel } from '../../lib/playbackCues'
import { INPUT } from '../ui/styles'
import { formatTimelineTime, parseTimelineTime } from '../../lib/timeline'
import { Button, Dialog, Field, IconButton, Segmented } from '../ui'
import { useTranslation } from 'react-i18next'

export type CueContent = Omit<ShowCue, 'id' | 'timeMs'>

/**
 * The cue form in one window (Marco, 2026-09-28): a dropdown for the device, one for its command,
 * then one per value of that command - each greyed out until the one before it is chosen, then
 * filled with what fits. A musician picks "NUX MG-30 → Patch wählen → 02B", never a MIDI number.
 * A device whose module describes no commands (lib/deviceCommands) gets the free-text command and
 * JSON payload of the cue list instead. Same look as the app's other dialogs (DialogHost.tsx).
 */
export function CueDialog({
  title,
  devices,
  initial,
  onSubmit,
  onCancel,
  withPlayback = true,
  initialTimeMs,
}: {
  title: string
  devices: readonly LogicalDevice[]
  initial?: CueContent
  /** With `initialTimeMs` the second argument is the (maybe moved) song time. */
  onSubmit: (content: CueContent, timeMs?: number) => void
  onCancel: () => void
  /** Also offer the cue's song time - typed, or − / + in tenths (#8: "a bit earlier" after a show).
   * The timeline moves a cue by dragging and leaves this out. */
  initialTimeMs?: number
  /** Offer "Wiedergabe: Klick & Ansagen" (a timeline cue). Off in the action picker, where the
   * click has its own group "Wiedergabe" - one place for it, not two (Marco, 2026-10-18). */
  withPlayback?: boolean
}) {
  const { t } = useTranslation('actions')
  // One device and nothing else to pick (the Rig-Check's device cue): it is chosen already - the
  // dialog said "Gerät wählen…" under the title "Rig-Check: Kemper" (2026-10-29).
  const onlyDevice = !withPlayback && devices.length === 1 ? devices[0]!.id : ''
  const [deviceId, setDeviceId] = useState(initial?.targetLogicalDeviceId ?? onlyDevice)
  const device = devices.find((d) => d.id === deviceId)
  const commands = device ? commandsFor(device.capability) : []
  const [commandType, setCommandType] = useState(initial && commands.some((c) => c.type === initial.type) ? initial.type : '')
  const command = commands.find((c) => c.type === commandType)
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initial?.payload ?? {}).map(([key, value]) => [key, String(value)])),
  )
  // Devices without described commands: the cue list's free-text fields.
  const [freeType, setFreeType] = useState(initial?.type ?? '')
  const [freePayload, setFreePayload] = useState(initial?.payload ? JSON.stringify(initial.payload) : '')
  const [error, setError] = useState<string | null>(null)
  const [timeText, setTimeText] = useState(initialTimeMs === undefined ? '' : formatTimelineTime(initialTimeMs))
  const timeMs = initialTimeMs === undefined ? undefined : parseTimelineTime(timeText)
  const stepTime = (deltaMs: number) => setTimeText(formatTimelineTime(Math.max(0, (timeMs ?? initialTimeMs ?? 0) + deltaMs)))
  // The own playback (#485): click and/or announcements off or on from here.
  const playback = deviceId === PLAYBACK_CUE_TARGET
  const initialSwitches = initial?.targetLogicalDeviceId === PLAYBACK_CUE_TARGET ? playbackSwitches(initial) : {}
  const [clickSwitch, setClickSwitch] = useState<Switch | ''>(initialSwitches.click ?? '')
  const [voiceSwitch, setVoiceSwitch] = useState<Switch | ''>(initialSwitches.voice ?? '')
  // The backing track's level (#485): unchanged, a level in dB, muted, or back to as uploaded.
  const initialTrack = initialSwitches.track
  const [trackMode, setTrackMode] = useState<'same' | 'level' | 'mute' | 'normal'>(
    !initialTrack ? 'same' : initialTrack.db === null ? 'mute' : initialTrack.db === 0 ? 'normal' : 'level',
  )
  const [trackDb, setTrackDb] = useState(initialTrack?.db ? String(initialTrack.db) : '-6')
  const [fadeAmount, setFadeAmount] = useState(initialTrack?.fade ? String(initialTrack.fade.amount) : '0')
  const [fadeUnit, setFadeUnit] = useState<FadeUnit>(initialTrack?.fade?.unit ?? 'bars')
  const dbValue = Number(trackDb.replace(',', '.').replace('−', '-'))
  const fadeValue = Number(fadeAmount.replace(',', '.'))
  const trackValid = trackMode !== 'level' || (Number.isFinite(dbValue) && dbValue >= -60 && dbValue <= 12 && trackDb.trim() !== '')
  const fadeValid = Number.isFinite(fadeValue) && fadeValue >= 0 && fadeAmount.trim() !== ''
  const trackLevel: TrackLevel | undefined =
    trackMode === 'same'
      ? undefined
      : { db: trackMode === 'mute' ? null : trackMode === 'normal' ? 0 : dbValue, ...(fadeValue > 0 ? { fade: { amount: fadeValue, unit: fadeUnit } } : {}) }

  const free = device !== undefined && commands.length === 0
  const timeOk = initialTimeMs === undefined || timeMs !== null
  const complete = !timeOk ? false : playback
    ? (clickSwitch !== '' || voiceSwitch !== '' || trackMode !== 'same') && trackValid && (trackMode === 'same' || fadeValid)
    : free
      ? freeType.trim().length > 0
      : command !== undefined && command.fields.every((f) => fieldAnswered(f, answers[f.key]))

  // The time goes along only where it was offered - the timeline's callers take one argument.
  const done = (content: CueContent) => (initialTimeMs === undefined ? onSubmit(content) : onSubmit(content, timeMs ?? initialTimeMs))
  function submit() {
    if (playback) {
      done(playbackCueContent({ click: clickSwitch || undefined, voice: voiceSwitch || undefined, track: trackLevel }))
      return
    }
    if (!device) return
    if (free) {
      const parsed = parseCuePayload(freePayload)
      if ('error' in parsed) {
        setError(parsed.error)
        return
      }
      done({ targetLogicalDeviceId: device.id, type: freeType.trim(), payload: parsed.payload })
      return
    }
    if (!command) return
    const parsed = payloadFromAnswers(command.fields, answers)
    if ('error' in parsed) {
      setError(parsed.error)
      return
    }
    done({ targetLogicalDeviceId: device.id, type: command.type, payload: command.fields.length > 0 ? parsed.payload : undefined })
  }

  const select = `min-h-form px-3 text-base ${INPUT}`
  const label = 'block text-sm font-semibold text-ink-soft'

  return (
    <Dialog
      title={title}
      size="s"
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onCancel}>{t('cancel')}</Button>
          <Button variant="primary" disabled={!complete} onClick={submit}>
            {t('apply')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >

        <label className={label}>
          <span className="mb-1 block">{t('cueDlg.device')}</span>
          <select
            className={select}
            value={deviceId}
            onChange={(e) => {
              setDeviceId(e.target.value)
              setCommandType('')
              setAnswers({})
              setError(null)
            }}
          >
            <option value="" disabled>
              {t('cueDlg.chooseDevice')}
            </option>
            {withPlayback && <option value={PLAYBACK_CUE_TARGET}>{t('cueDlg.playback')}</option>}
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

        {playback ? (
          <>
            {(
              [
                [t('cueDlg.click'), clickSwitch, setClickSwitch],
                [t('cueDlg.voice'), voiceSwitch, setVoiceSwitch],
              ] as const
            ).map(([name, value, set]) => (
              <Segmented
                key={name}
                label={name}
                showLabel
                value={value === '' ? 'same' : value}
                onChange={(v) => set(v === 'same' ? '' : v)}
                options={[
                  { value: 'same', label: t('cueDlg.same') },
                  { value: 'off', label: t('cueDlg.off') },
                  { value: 'on', label: t('cueDlg.on') },
                ]}
              />
            ))}
            <Segmented
              label={t('cueDlg.track')}
              showLabel
              value={trackMode}
              onChange={setTrackMode}
              options={[
                { value: 'same', label: t('cueDlg.same') },
                { value: 'level', label: t('cueDlg.db') },
                { value: 'mute', label: t('cueDlg.mute') },
                { value: 'normal', label: t('cueDlg.normal') },
              ]}
            />
            {trackMode === 'level' && (
              <Field label={t('cueDlg.level')} inputMode="decimal" value={trackDb} onChange={(e) => setTrackDb(e.target.value)} error={trackValid ? undefined : t('cueDlg.levelError')} />
            )}
            {trackMode !== 'same' && (
              <div className="flex items-end gap-2">
                <div className="w-28">
                  <Field label={t('cueDlg.fade')} inputMode="decimal" value={fadeAmount} onChange={(e) => setFadeAmount(e.target.value)} error={fadeValid ? undefined : t('cueDlg.fadeError')} />
                </div>
                <div className="min-w-0 flex-1">
                  <Segmented
                    label={t('cueDlg.unit')}
                    value={fadeUnit}
                    onChange={setFadeUnit}
                    options={[
                      { value: 'bars', label: t('cueDlg.bars') },
                      { value: 'beats', label: t('cueDlg.beats') },
                      { value: 'ms', label: t('cueDlg.ms') },
                    ]}
                  />
                </div>
              </div>
            )}
            <p className="text-sm text-ink-muted">{t('cueDlg.until')}</p>
          </>
        ) : free ? (
          <>
            <label className={label}>
              <span className="mb-1 block">{t('cueDlg.commandType')}</span>
              <input className={select} value={freeType} onChange={(e) => setFreeType(e.target.value)} />
            </label>
            <label className={label}>
              <span className="mb-1 block">{t('cueDlg.payload')}</span>
              <textarea rows={3} className={`px-3 py-2 ${INPUT}`} value={freePayload} onChange={(e) => setFreePayload(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <label className={label}>
              <span className="mb-1 block">{t('cueDlg.command')}</span>
              <select
                className={select}
                value={commandType}
                disabled={!device}
                onChange={(e) => {
                  setCommandType(e.target.value)
                  setAnswers({})
                  setError(null)
                }}
              >
                <option value="" disabled>
                  {device ? t('cueDlg.chooseCommand') : t('cueDlg.deviceFirst')}
                </option>
                {commands.map((c) => (
                  <option key={c.type} value={c.type}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            {(command?.fields ?? [{ key: '__placeholder', label: t('cueDlg.value'), kind: 'bool' as const }]).map((field, i, fields) => {
              // Each value opens once the command and every value before it are chosen.
              const enabled = command !== undefined && fields.slice(0, i).every((f) => fieldAnswered(f, answers[f.key]))
              if (field.kind === 'text')
                return (
                  <label key={field.key} className={label}>
                    <span className="mb-1 block">{field.label}</span>
                    <input
                      className={select}
                      value={answers[field.key] ?? ''}
                      placeholder={field.placeholder}
                      disabled={!enabled}
                      onChange={(e) => {
                        setAnswers((prev) => ({ ...prev, [field.key]: e.target.value }))
                        setError(null)
                      }}
                    />
                  </label>
                )
              return (
                <label key={field.key} className={label}>
                  <span className="mb-1 block">{field.label}</span>
                  <select
                    className={select}
                    value={command ? (answers[field.key] ?? '') : ''}
                    disabled={!enabled}
                    onChange={(e) => {
                      setAnswers((prev) => ({ ...prev, [field.key]: e.target.value }))
                      setError(null)
                    }}
                  >
                    <option value="" disabled>
                      {!command ? t('cueDlg.commandFirst') : enabled ? t('cueDlg.chooseField', { field: field.label }) : t('cueDlg.previousFirst')}
                    </option>
                    {command &&
                      fieldOptions(field).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                  </select>
                </label>
              )
            })}
          </>
        )}

        {initialTimeMs !== undefined && (
          <div>
            <span className={`${label} mb-1`}>{t('cueDlg.time')}</span>
            <div className="flex items-center gap-2" role="group" aria-label={t('cueDlg.time')}>
              <IconButton icon="decrease" label={t('cueDlg.earlier')} onClick={() => stepTime(-100)} />
              <input
                aria-label={t('cueDlg.timeAria')}
                inputMode="decimal"
                className={`min-w-0 flex-1 text-center tabular-nums ${select}`}
                value={timeText}
                onChange={(e) => setTimeText(e.target.value)}
              />
              <IconButton icon="increase" label={t('cueDlg.later')} onClick={() => stepTime(100)} />
            </div>
            {timeMs === null && <p className="mt-1 text-sm text-warn">{t('cueDlg.timeError')}</p>}
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
      </form>
    </Dialog>
  )
}
